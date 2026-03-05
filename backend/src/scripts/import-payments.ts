/**
 * Import missing payments from Excel into CRM.
 *
 * Compares per-client total payments in Excel vs CRM, and creates
 * the missing payments allocated via FIFO to oldest unpaid deals.
 *
 * Run:
 *   cd backend && npx tsx src/scripts/import-payments.ts            # dry-run
 *   cd backend && npx tsx src/scripts/import-payments.ts --execute   # live import
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

// ───────── constants ─────────

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

// Standard layout (Jan 2025 – Jan 2026): month-specific sub-columns
const PAYMENT_COLS_STANDARD = [
  { index: 12, method: 'CASH' },
  { index: 15, method: 'TRANSFER' },
  { index: 18, method: 'QR' },
  { index: 21, method: 'CLICK' },
  { index: 24, method: 'TERMINAL' },
];

// Shifted layout (Feb 2026): +1 offset due to extra "договор номер" column
const PAYMENT_COLS_SHIFTED = [
  { index: 13, method: 'CASH' },
  { index: 16, method: 'TRANSFER' },
  { index: 19, method: 'QR' },
  { index: 22, method: 'CLICK' },
  { index: 25, method: 'TERMINAL' },
];

const EXCEL_FILES = [
  { name: '29.12.2025.xlsx', defaultYear: 2025 },
  { name: '28.02.2026.xlsx', defaultYear: 2026 },
];

// ───────── helpers ─────────

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function normLower(s: unknown): string {
  return norm(s).toLowerCase();
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

type Row = unknown[];

interface ExcelPayment {
  amount: number;
  method: string;
  month: number;   // 0-based
  year: number;
  paidAt: Date;
}

interface ClientExcelData {
  payments: ExcelPayment[];
  totalPaid: number;
}

// ───────── Step 1: Parse Excel ─────────

function parseAllExcelPayments(): Map<string, ClientExcelData> {
  const clientMap = new Map<string, ClientExcelData>();

  for (const file of EXCEL_FILES) {
    const fpath = path.resolve(process.cwd(), '..', file.name);
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.readFile(fpath);
    } catch {
      console.log(`  WARNING: Cannot open ${file.name}, skipping`);
      continue;
    }

    console.log(`  Reading ${file.name} (${wb.SheetNames.length} sheets)`);

    for (const sheetName of wb.SheetNames) {
      const sn = sheetName.toLowerCase().trim();
      if (sn === 'лист1' || sn === 'лист2') continue;

      // Detect month from sheet name
      let monthIdx = -1;
      for (let m = 0; m < MONTH_NAMES.length; m++) {
        if (sn.startsWith(MONTH_NAMES[m])) {
          monthIdx = m;
          break;
        }
      }
      if (monthIdx < 0) {
        console.log(`    Skipping sheet "${sheetName}" — can't detect month`);
        continue;
      }

      // Detect year from sheet name or use default
      const yearMatch = sheetName.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : file.defaultYear;

      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

      // Detect layout: check if header row 1 cell [11] contains "договор"
      const h1 = data[1] as Row | undefined;
      const isShifted = h1 ? normLower(h1[11]).includes('договор') : false;
      const paymentCols = isShifted ? PAYMENT_COLS_SHIFTED : PAYMENT_COLS_STANDARD;

      // Use mid-month date; cap at current date to prevent future dates
      const midMonth = new Date(Date.UTC(year, monthIdx, 15));
      const now = new Date();
      const paidAt = midMonth > now ? now : midMonth;

      let sheetPayments = 0;
      let sheetTotal = 0;

      for (let i = 3; i < data.length; i++) {
        const row = data[i] as Row;
        if (!row) continue;
        const clientName = normalizeClientName(row[1]);
        if (!clientName) continue;

        for (const pc of paymentCols) {
          const amt = numVal(row[pc.index]);
          if (amt > 0) {
            if (!clientMap.has(clientName)) {
              clientMap.set(clientName, { payments: [], totalPaid: 0 });
            }
            const cd = clientMap.get(clientName)!;
            cd.payments.push({ amount: amt, method: pc.method, month: monthIdx, year, paidAt });
            cd.totalPaid += amt;
            sheetPayments++;
            sheetTotal += amt;
          }
        }
      }

      console.log(`    ${sheetName}: ${sheetPayments} payments, total ${sheetTotal.toLocaleString()}`);
    }
  }

  return clientMap;
}

// ───────── Step 2: Match clients ─────────

async function matchClients(
  excelClients: Map<string, ClientExcelData>,
): Promise<{
  matched: Map<string, { clientId: string; crmName: string }>;
  unmatched: Map<string, ClientExcelData>;
}> {
  const allCrmClients = await prisma.client.findMany({
    select: { id: true, companyName: true },
  });

  // Build normalized CRM map (token-sorted)
  const crmNorm = new Map<string, { id: string; name: string }>();
  for (const c of allCrmClients) {
    const key = normalizeClientName(c.companyName);
    crmNorm.set(key, { id: c.id, name: c.companyName });
  }

  const matched = new Map<string, { clientId: string; crmName: string }>();
  const unmatched = new Map<string, ClientExcelData>();

  // Pass 1: exact match
  for (const [excelKey, excelData] of excelClients) {
    if (crmNorm.has(excelKey)) {
      const crm = crmNorm.get(excelKey)!;
      matched.set(excelKey, { clientId: crm.id, crmName: crm.name });
    }
  }

  // Pass 2: substring/prefix matching for unmatched
  const unmatchedKeys = [...excelClients.keys()].filter(k => !matched.has(k));
  const usedCrmIds = new Set([...matched.values()].map(v => v.clientId));

  for (const excelKey of unmatchedKeys) {
    let bestMatch: { id: string; name: string } | null = null;
    let bestLen = 0;

    for (const [crmKey, crmVal] of crmNorm) {
      if (usedCrmIds.has(crmVal.id)) continue;
      // Check if one starts with the other
      if (crmKey.startsWith(excelKey) || excelKey.startsWith(crmKey)) {
        const len = Math.min(excelKey.length, crmKey.length);
        if (len > bestLen) {
          bestLen = len;
          bestMatch = crmVal;
        }
      }
    }

    if (bestMatch && bestLen >= 3) {
      matched.set(excelKey, { clientId: bestMatch.id, crmName: bestMatch.name });
      usedCrmIds.add(bestMatch.id);
    } else {
      unmatched.set(excelKey, excelClients.get(excelKey)!);
    }
  }

  return { matched, unmatched };
}

// ───────── Step 3–5: Reconcile & allocate ─────────

interface PaymentToCreate {
  dealId: string;
  clientId: string;
  amount: number;
  method: string;
  paidAt: Date;
  note: string;
}

interface ClientReconciliation {
  clientName: string;
  crmTotalPaid: number;
  excelTotalPaid: number;
  deficit: number;
  newPayments: PaymentToCreate[];
  dealUpdates: { dealId: string; newPaidAmount: number; newStatus: string }[];
}

async function reconcileClient(
  excelKey: string,
  clientId: string,
  crmName: string,
  excelData: ClientExcelData,
): Promise<ClientReconciliation> {
  // Load CRM payments
  const crmPayments = await prisma.payment.findMany({
    where: { clientId },
    select: { amount: true },
  });
  const crmTotalPaid = crmPayments.reduce((s, p) => s + Number(p.amount), 0);

  // Load CRM deals
  const deals = await prisma.deal.findMany({
    where: { clientId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, paidAmount: true, paymentStatus: true, createdAt: true },
  });

  const deficit = excelData.totalPaid - crmTotalPaid;

  const result: ClientReconciliation = {
    clientName: crmName,
    crmTotalPaid,
    excelTotalPaid: excelData.totalPaid,
    deficit,
    newPayments: [],
    dealUpdates: [],
  };

  if (deficit <= 0 || deals.length === 0) return result;

  // Sort Excel payments chronologically
  const sortedPayments = [...excelData.payments].sort((a, b) => {
    const da = a.year * 12 + a.month;
    const db = b.year * 12 + b.month;
    return da - db;
  });

  // Skip first crmTotalPaid worth of Excel payments (already in CRM)
  let remainingToSkip = crmTotalPaid;
  const newExcelPayments: ExcelPayment[] = [];

  for (const ep of sortedPayments) {
    if (remainingToSkip >= ep.amount) {
      remainingToSkip -= ep.amount;
    } else if (remainingToSkip > 0) {
      const newAmount = ep.amount - remainingToSkip;
      remainingToSkip = 0;
      newExcelPayments.push({ ...ep, amount: newAmount });
    } else {
      newExcelPayments.push(ep);
    }
  }

  // FIFO allocation to deals
  // Build deal debt tracker
  const dealDebts = deals.map(d => ({
    dealId: d.id,
    amount: Number(d.amount),
    paidAmount: Number(d.paidAmount),
    remaining: Math.max(Number(d.amount) - Number(d.paidAmount), 0),
    addedPayments: 0,
  }));

  let dealIdx = 0;

  for (const ep of newExcelPayments) {
    let amountLeft = ep.amount;

    while (amountLeft > 0) {
      // Find next deal with remaining debt
      while (dealIdx < dealDebts.length && dealDebts[dealIdx].remaining <= 0) {
        dealIdx++;
      }

      if (dealIdx >= dealDebts.length) {
        // No more deals with debt — assign to last deal (overpayment)
        const lastDeal = dealDebts[dealDebts.length - 1];
        result.newPayments.push({
          dealId: lastDeal.dealId,
          clientId,
          amount: amountLeft,
          method: ep.method,
          paidAt: ep.paidAt,
          note: `Импорт из Excel: ${MONTH_NAMES_RU[ep.month]} ${ep.year}`,
        });
        lastDeal.addedPayments += amountLeft;
        lastDeal.remaining -= amountLeft; // will go negative (overpayment)
        amountLeft = 0;
        break;
      }

      const deal = dealDebts[dealIdx];
      const allocate = Math.min(amountLeft, deal.remaining);

      result.newPayments.push({
        dealId: deal.dealId,
        clientId,
        amount: allocate,
        method: ep.method,
        paidAt: ep.paidAt,
        note: `Импорт из Excel: ${MONTH_NAMES_RU[ep.month]} ${ep.year}`,
      });

      deal.remaining -= allocate;
      deal.addedPayments += allocate;
      amountLeft -= allocate;
    }
  }

  // Compute deal updates
  for (const dd of dealDebts) {
    if (dd.addedPayments > 0) {
      const newPaidAmount = dd.paidAmount + dd.addedPayments;
      let newStatus: string;
      if (newPaidAmount >= dd.amount) {
        newStatus = 'PAID';
      } else if (newPaidAmount > 0) {
        newStatus = 'PARTIAL';
      } else {
        newStatus = 'UNPAID';
      }
      result.dealUpdates.push({
        dealId: dd.dealId,
        newPaidAmount,
        newStatus,
      });
    }
  }

  return result;
}

// ───────── Step 6: Execute import ─────────

async function executeImport(
  reconciliations: ClientReconciliation[],
  adminUserId: string,
): Promise<void> {
  let totalCreated = 0;
  let totalAmount = 0;
  let clientsDone = 0;

  for (const rec of reconciliations) {
    if (rec.newPayments.length === 0) continue;

    try {
      await prisma.$transaction(async (tx) => {
        // Create payments
        for (const p of rec.newPayments) {
          await tx.payment.create({
            data: {
              dealId: p.dealId,
              clientId: p.clientId,
              amount: p.amount,
              method: p.method,
              paidAt: p.paidAt,
              createdBy: adminUserId,
              note: p.note,
              createdAt: p.paidAt,
            },
          });
        }

        // Update deals
        for (const du of rec.dealUpdates) {
          await tx.deal.updateMany({
            where: { id: du.dealId },
            data: {
              paidAmount: du.newPaidAmount,
              paymentStatus: du.newStatus as any,
            },
          });
        }
      });

      totalCreated += rec.newPayments.length;
      totalAmount += rec.deficit;
      clientsDone++;
      console.log(`  [${clientsDone}] ${rec.clientName}: ${rec.newPayments.length} payments, ${rec.deficit.toLocaleString()} sum`);
    } catch (err) {
      console.error(`  ERROR: ${rec.clientName}: ${(err as Error).message}`);
    }
  }

  console.log(`\n  IMPORT COMPLETE: ${totalCreated} payments created, ${totalAmount.toLocaleString()} total`);
}

// ───────── main ─────────

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(60));
  console.log(`  PAYMENT IMPORT ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(60));

  // Find admin user
  const adminUser = await prisma.user.findFirst({
    where: { OR: [{ login: 'admin' }, { role: 'SUPER_ADMIN' }] },
    select: { id: true, login: true },
  });
  if (!adminUser) {
    console.error('ERROR: No admin user found');
    process.exit(1);
  }
  console.log(`\nAdmin user: ${adminUser.login} (${adminUser.id})`);

  // Step 1: Parse Excel
  console.log('\n[1/4] Parsing Excel files...');
  const excelClients = parseAllExcelPayments();
  console.log(`  Total Excel clients: ${excelClients.size}`);
  let grandExcelTotal = 0;
  for (const [, cd] of excelClients) grandExcelTotal += cd.totalPaid;
  console.log(`  Grand total Excel payments: ${grandExcelTotal.toLocaleString()}`);

  // Step 2: Match clients
  console.log('\n[2/4] Matching clients...');
  const { matched, unmatched } = await matchClients(excelClients);
  console.log(`  Matched: ${matched.size}`);
  console.log(`  Unmatched: ${unmatched.size}`);

  // Step 3–5: Reconcile
  console.log('\n[3/4] Reconciling per client...');
  const reconciliations: ClientReconciliation[] = [];
  let idx = 0;

  for (const [excelKey, match] of matched) {
    idx++;
    const excelData = excelClients.get(excelKey)!;
    const rec = await reconcileClient(excelKey, match.clientId, match.crmName, excelData);
    reconciliations.push(rec);
    if (idx % 50 === 0) console.log(`  ... processed ${idx}/${matched.size} clients`);
  }

  // Sort by deficit descending
  reconciliations.sort((a, b) => b.deficit - a.deficit);

  // Dry-run report
  console.log('\n' + '='.repeat(60));
  console.log('  RECONCILIATION REPORT');
  console.log('='.repeat(60));

  const withDeficit = reconciliations.filter(r => r.deficit > 0);
  const noDeficit = reconciliations.filter(r => r.deficit <= 0);

  let totalDeficit = 0;
  let totalNewPayments = 0;

  console.log('\nCLIENTS WITH PAYMENT DEFICIT:');
  console.log(`${'Client'.padEnd(35)} | ${'CRM Paid'.padStart(14)} | ${'Excel Paid'.padStart(14)} | ${'Deficit'.padStart(14)} | ${'New Pmts'.padStart(8)}`);
  console.log('-'.repeat(95));

  for (const rec of withDeficit) {
    totalDeficit += rec.deficit;
    totalNewPayments += rec.newPayments.length;
    console.log(
      `${rec.clientName.substring(0, 35).padEnd(35)} | ` +
      `${rec.crmTotalPaid.toLocaleString().padStart(14)} | ` +
      `${rec.excelTotalPaid.toLocaleString().padStart(14)} | ` +
      `${rec.deficit.toLocaleString().padStart(14)} | ` +
      `${String(rec.newPayments.length).padStart(8)}`
    );
  }

  if (noDeficit.length > 0) {
    console.log(`\nSKIPPED (no deficit): ${noDeficit.length} clients`);
    for (const rec of noDeficit.slice(0, 10)) {
      console.log(`  "${rec.clientName}" — CRM=${rec.crmTotalPaid.toLocaleString()} Excel=${rec.excelTotalPaid.toLocaleString()}`);
    }
    if (noDeficit.length > 10) console.log(`  ... and ${noDeficit.length - 10} more`);
  }

  if (unmatched.size > 0) {
    console.log(`\nUNMATCHED EXCEL CLIENTS (${unmatched.size}):`);
    const unmatchedSorted = [...unmatched.entries()].sort((a, b) => b[1].totalPaid - a[1].totalPaid);
    for (const [name, data] of unmatchedSorted.slice(0, 20)) {
      console.log(`  "${name}" — Excel payments: ${data.totalPaid.toLocaleString()}`);
    }
    if (unmatchedSorted.length > 20) console.log(`  ... and ${unmatchedSorted.length - 20} more`);
  }

  // Current CRM total debt
  const currentDebt = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as total
    FROM deals d WHERE d.is_archived = false`
  );
  const currentDebtNum = Number(currentDebt[0].total);

  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Matched clients: ${matched.size}`);
  console.log(`  Clients with deficit: ${withDeficit.length}`);
  console.log(`  Total new payments to create: ${totalNewPayments}`);
  console.log(`  Total deficit to import: ${totalDeficit.toLocaleString()}`);
  console.log(`  Current CRM debt: ${currentDebtNum.toLocaleString()}`);
  console.log(`  Estimated debt after import: ${(currentDebtNum - totalDeficit).toLocaleString()}`);
  console.log(`  Excel target (Feb 2026 closing): ~1,013,072,673`);

  // Step 4: Execute if requested
  if (isExecute) {
    console.log('\n[4/4] EXECUTING IMPORT...');
    await executeImport(withDeficit, adminUser.id);
  } else {
    console.log('\n  This was a DRY-RUN. To execute, run with --execute flag.');
  }
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
