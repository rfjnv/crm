/**
 * Sync CRM payments with Excel closing balances.
 *
 * For each client:
 *   1. Get CRM net debt: SUM(deal.amount - deal.paid_amount)
 *   2. Get Excel closing balance from the latest available month
 *   3. If CRM debt > Excel closing -> create reconciliation payment(s)
 *   4. FIFO allocate payment(s) to oldest unpaid deals
 *
 * Outputs a reconciliation table (console + CSV).
 *
 * Run:
 *   cd backend && npx tsx src/scripts/sync-payments.ts            # dry-run
 *   cd backend && npx tsx src/scripts/sync-payments.ts --execute   # live import
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

// ─────────── constants ───────────

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const EXCEL_FILES = [
  { name: '29.12.2025.xlsx', defaultYear: 2025 },
  { name: 'frontend/05.03.2026.xlsx', defaultYear: 2026 },
];

/**
 * Determine closing-balance column index dynamically per sheet.
 * 2025 sheets + Jan 2026 have 28 columns (A–AB):  balance at col 26 (AA)
 * Feb 2026 has 29 columns (A–AC):                 balance at col 27 (AB)
 * Rule: balance column = total_columns - 2  (always 2nd-to-last before "число")
 */
function getClosingBalanceCol(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref'];
  if (!ref) return 26;
  const range = XLSX.utils.decode_range(ref);
  const totalCols = range.e.c + 1;
  // 28 cols → index 26 (AA);  29 cols → index 27 (AB)
  return totalCols - 2;
}

// ─────────── helpers ───────────

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

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

type Row = unknown[];

// ─────────── types ───────────

interface ClientExcelBalance {
  closingBalance: number;
  latestYear: number;
  latestMonth: number; // 0-based
  sheetName: string;
}

interface PaymentToCreate {
  dealId: string;
  clientId: string;
  amount: number;
  paidAt: Date;
  note: string;
}

interface DealUpdate {
  dealId: string;
  newPaidAmount: number;
  newStatus: string;
}

interface ReconciliationRow {
  clientName: string;
  clientId: string;
  crmDebt: number;       // SUM(deal.amount - deal.paid_amount), net
  excelClosing: number;  // Closing balance from Excel
  gap: number;           // crmDebt - excelClosing (>0 means CRM has more debt)
  paymentTotal: number;  // Payment amount created
  paymentsCreated: number;
  dealsUpdated: number;
  status: string;
}

// ─────────── Step 1: Parse Excel closing balances ───────────

function parseExcelClosingBalances(): Map<string, ClientExcelBalance> {
  const clientMap = new Map<string, ClientExcelBalance>();

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

      // Detect year
      const yearMatch = sheetName.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : file.defaultYear;
      const monthKey = year * 12 + monthIdx;

      const ws = wb.Sheets[sheetName];
      const closingCol = getClosingBalanceCol(ws);
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

      // Sum closing balance per client within this sheet
      const sheetBalances = new Map<string, number>();

      for (let i = 3; i < data.length; i++) {
        const row = data[i] as Row;
        if (!row) continue;
        const clientName = normalizeClientName(row[1]);
        if (!clientName) continue;

        const closing = numVal(row[closingCol]);
        sheetBalances.set(clientName, (sheetBalances.get(clientName) || 0) + closing);
      }

      // Update client map: keep only the LATEST month per client
      let sheetUpdated = 0;
      for (const [clientName, balance] of sheetBalances) {
        const existing = clientMap.get(clientName);
        const existingKey = existing ? existing.latestYear * 12 + existing.latestMonth : -1;

        if (!existing || monthKey > existingKey) {
          clientMap.set(clientName, {
            closingBalance: balance,
            latestYear: year,
            latestMonth: monthIdx,
            sheetName,
          });
          sheetUpdated++;
        }
      }

      console.log(`    ${sheetName}: ${sheetBalances.size} clients, ${sheetUpdated} set as latest (balanceCol=${closingCol})`);
    }
  }

  return clientMap;
}

// ─────────── Step 2: Match Excel clients to CRM ───────────

async function matchClients(
  excelClients: Map<string, ClientExcelBalance>,
): Promise<{
  matched: Map<string, { clientId: string; crmName: string; excelBalance: ClientExcelBalance }>;
  unmatched: string[];
}> {
  const allCrmClients = await prisma.client.findMany({
    select: { id: true, companyName: true },
  });

  // Build normalized CRM lookup (token-sorted)
  const crmNorm = new Map<string, { id: string; name: string }>();
  for (const c of allCrmClients) {
    crmNorm.set(normalizeClientName(c.companyName), { id: c.id, name: c.companyName });
  }

  const matched = new Map<string, { clientId: string; crmName: string; excelBalance: ClientExcelBalance }>();
  const unmatched: string[] = [];

  // Pass 1: exact normalized match
  for (const [excelKey, excelBal] of excelClients) {
    if (crmNorm.has(excelKey)) {
      const crm = crmNorm.get(excelKey)!;
      matched.set(excelKey, { clientId: crm.id, crmName: crm.name, excelBalance: excelBal });
    }
  }

  // Pass 2: prefix/substring matching for unmatched
  const unmatchedKeys = [...excelClients.keys()].filter(k => !matched.has(k));
  const usedCrmIds = new Set([...matched.values()].map(v => v.clientId));

  for (const excelKey of unmatchedKeys) {
    let bestMatch: { id: string; name: string } | null = null;
    let bestLen = 0;

    for (const [crmKey, crmVal] of crmNorm) {
      if (usedCrmIds.has(crmVal.id)) continue;
      if (crmKey.startsWith(excelKey) || excelKey.startsWith(crmKey)) {
        const len = Math.min(excelKey.length, crmKey.length);
        if (len > bestLen) {
          bestLen = len;
          bestMatch = crmVal;
        }
      }
    }

    if (bestMatch && bestLen >= 3) {
      matched.set(excelKey, {
        clientId: bestMatch.id,
        crmName: bestMatch.name,
        excelBalance: excelClients.get(excelKey)!,
      });
      usedCrmIds.add(bestMatch.id);
    } else {
      unmatched.push(excelKey);
    }
  }

  return { matched, unmatched };
}

// ─────────── Step 3: Get CRM client net debts ───────────

async function getCrmClientDebts(): Promise<
  Map<string, { name: string; net: number; grossDebt: number; dealCount: number }>
> {
  const rows = await prisma.$queryRaw<
    { client_id: string; company_name: string; deal_count: string; net: string; gross_debt: string }[]
  >(
    Prisma.sql`
      SELECT
        c.id as client_id,
        c.company_name,
        COUNT(d.id)::text as deal_count,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net,
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross_debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
      GROUP BY c.id, c.company_name
    `
  );

  const map = new Map<string, { name: string; net: number; grossDebt: number; dealCount: number }>();
  for (const r of rows) {
    map.set(r.client_id, {
      name: r.company_name,
      net: Number(r.net),
      grossDebt: Number(r.gross_debt),
      dealCount: Number(r.deal_count),
    });
  }
  return map;
}

// ─────────── Step 4: FIFO allocate payment to deals ───────────

async function fifoAllocate(
  clientId: string,
  totalPayment: number,
  paidAt: Date,
  note: string,
): Promise<{ payments: PaymentToCreate[]; dealUpdates: DealUpdate[] }> {
  // Get all non-archived deals, oldest first
  const deals = await prisma.deal.findMany({
    where: { clientId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, paidAmount: true },
  });

  if (deals.length === 0) return { payments: [], dealUpdates: [] };

  const dealSlots = deals.map(d => ({
    dealId: d.id,
    amount: Number(d.amount),
    currentPaid: Number(d.paidAmount),
    remaining: Math.max(Number(d.amount) - Number(d.paidAmount), 0),
    added: 0,
  }));

  let remaining = totalPayment;
  let dealIdx = 0;

  const payments: PaymentToCreate[] = [];

  while (remaining > 0.01) {
    // Skip fully paid deals
    while (dealIdx < dealSlots.length && dealSlots[dealIdx].remaining <= 0) {
      dealIdx++;
    }

    if (dealIdx >= dealSlots.length) {
      // All deals fully paid — assign remainder to last deal (overpayment)
      const lastDeal = dealSlots[dealSlots.length - 1];
      const amt = Math.round(remaining * 100) / 100;
      payments.push({ dealId: lastDeal.dealId, clientId, amount: amt, paidAt, note });
      lastDeal.added += amt;
      remaining = 0;
      break;
    }

    const deal = dealSlots[dealIdx];
    const allocate = Math.round(Math.min(remaining, deal.remaining) * 100) / 100;

    payments.push({ dealId: deal.dealId, clientId, amount: allocate, paidAt, note });

    deal.added += allocate;
    deal.remaining -= allocate;
    remaining -= allocate;
  }

  // Compute deal updates
  const dealUpdates: DealUpdate[] = [];
  for (const ds of dealSlots) {
    if (ds.added > 0) {
      const newPaid = Math.round((ds.currentPaid + ds.added) * 100) / 100;
      dealUpdates.push({
        dealId: ds.dealId,
        newPaidAmount: newPaid,
        newStatus: computePaymentStatus(newPaid, ds.amount),
      });
    }
  }

  return { payments, dealUpdates };
}

// ─────────── Step 5: Execute single-client import ───────────

async function executeClientImport(
  payments: PaymentToCreate[],
  dealUpdates: DealUpdate[],
  adminUserId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Create Payment records
    for (const p of payments) {
      await tx.payment.create({
        data: {
          dealId: p.dealId,
          clientId: p.clientId,
          amount: p.amount,
          method: 'TRANSFER',
          paidAt: p.paidAt,
          createdBy: adminUserId,
          note: p.note,
          createdAt: p.paidAt,
        },
      });
    }

    // Update Deal.paidAmount and paymentStatus
    for (const du of dealUpdates) {
      await tx.deal.updateMany({
        where: { id: du.dealId },
        data: {
          paidAmount: du.newPaidAmount,
          paymentStatus: du.newStatus as any,
        },
      });
    }
  }, { maxWait: 30000, timeout: 60000 });
}

// ─────────── main ───────────

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(70));
  console.log(`  CRM <-> EXCEL PAYMENT SYNC  ${isExecute ? '** LIVE IMPORT **' : '(DRY-RUN)'}`);
  console.log('='.repeat(70));

  // ── Find admin user ──
  const adminUser = await prisma.user.findFirst({
    where: { OR: [{ login: 'admin' }, { role: 'SUPER_ADMIN' }] },
    select: { id: true, login: true },
  });
  if (!adminUser) {
    console.error('ERROR: No admin user found');
    process.exit(1);
  }
  console.log(`\nAdmin: ${adminUser.login} (${adminUser.id})`);

  // ── Step 1: Parse Excel ──
  console.log('\n[1/5] Parsing Excel closing balances...');
  const excelBalances = parseExcelClosingBalances();
  console.log(`  Total Excel clients with closing balance: ${excelBalances.size}`);

  let totalExcelClosing = 0;
  for (const [, eb] of excelBalances) totalExcelClosing += eb.closingBalance;
  console.log(`  Total Excel closing balance: ${fmtNum(totalExcelClosing)}`);

  // ── Step 2: Match clients ──
  console.log('\n[2/5] Matching Excel clients to CRM...');
  const { matched, unmatched } = await matchClients(excelBalances);
  console.log(`  Matched: ${matched.size}`);
  console.log(`  Unmatched (Excel-only): ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log('  Unmatched clients:');
    const sorted = unmatched
      .map(k => ({ name: k, bal: excelBalances.get(k)!.closingBalance }))
      .sort((a, b) => Math.abs(b.bal) - Math.abs(a.bal));
    for (const u of sorted.slice(0, 15)) {
      console.log(`    "${u.name}": closing=${fmtNum(u.bal)}`);
    }
    if (sorted.length > 15) console.log(`    ... and ${sorted.length - 15} more`);
  }

  // ── Step 3: Get CRM debts ──
  console.log('\n[3/5] Loading CRM client debts...');
  const crmDebts = await getCrmClientDebts();
  console.log(`  CRM clients with active deals: ${crmDebts.size}`);

  let totalCrmNet = 0;
  let totalCrmGross = 0;
  for (const [, cd] of crmDebts) {
    totalCrmNet += cd.net;
    totalCrmGross += cd.grossDebt;
  }
  console.log(`  CRM total net debt: ${fmtNum(totalCrmNet)}`);
  console.log(`  CRM total gross debt: ${fmtNum(totalCrmGross)}`);

  // ── Step 4: Reconcile & import ──
  console.log('\n[4/5] Reconciling and allocating payments...');

  const reconciliation: ReconciliationRow[] = [];
  let totalGap = 0;
  let totalPaymentsToCreate = 0;
  let clientsToImport = 0;
  let clientsImported = 0;
  let clientErrors = 0;

  // Process matched clients
  for (const [, matchData] of matched) {
    const crm = crmDebts.get(matchData.clientId);
    const crmDebt = crm ? crm.net : 0;
    const excelClosing = matchData.excelBalance.closingBalance;
    const gap = crmDebt - excelClosing;

    // Skip if no meaningful gap (CRM debt <= Excel closing)
    if (gap < 1) {
      reconciliation.push({
        clientName: matchData.crmName,
        clientId: matchData.clientId,
        crmDebt,
        excelClosing,
        gap,
        paymentTotal: 0,
        paymentsCreated: 0,
        dealsUpdated: 0,
        status: Math.abs(gap) < 1 ? 'OK' : 'EXCEL>CRM',
      });
      continue;
    }

    // Gap > 0: CRM shows more debt than Excel -> need to import payment
    // Use last day of the month; cap at current date to prevent future dates
    const lastDayOfMonth = new Date(Date.UTC(
      matchData.excelBalance.latestYear,
      matchData.excelBalance.latestMonth + 1,
      0,
    ));
    const now = new Date();
    const paidAt = lastDayOfMonth > now ? now : lastDayOfMonth;
    const monthName = MONTH_NAMES_RU[matchData.excelBalance.latestMonth];
    const note = `Сверка CRM-Excel: ${monthName} ${matchData.excelBalance.latestYear}`;

    const { payments, dealUpdates } = await fifoAllocate(matchData.clientId, gap, paidAt, note);

    if (payments.length === 0) {
      reconciliation.push({
        clientName: matchData.crmName,
        clientId: matchData.clientId,
        crmDebt,
        excelClosing,
        gap,
        paymentTotal: 0,
        paymentsCreated: 0,
        dealsUpdated: 0,
        status: 'NO_DEALS',
      });
      continue;
    }

    totalGap += gap;
    totalPaymentsToCreate += payments.length;
    clientsToImport++;

    if (isExecute) {
      try {
        await executeClientImport(payments, dealUpdates, adminUser.id);
        clientsImported++;

        reconciliation.push({
          clientName: matchData.crmName,
          clientId: matchData.clientId,
          crmDebt,
          excelClosing,
          gap,
          paymentTotal: gap,
          paymentsCreated: payments.length,
          dealsUpdated: dealUpdates.length,
          status: 'IMPORTED',
        });

        if (clientsImported % 20 === 0) {
          console.log(`  ... imported ${clientsImported}/${clientsToImport} clients`);
        }
      } catch (err) {
        clientErrors++;
        console.error(`  ERROR [${matchData.crmName}]: ${(err as Error).message.slice(0, 100)}`);
        reconciliation.push({
          clientName: matchData.crmName,
          clientId: matchData.clientId,
          crmDebt,
          excelClosing,
          gap,
          paymentTotal: 0,
          paymentsCreated: 0,
          dealsUpdated: 0,
          status: 'ERROR',
        });
      }
    } else {
      reconciliation.push({
        clientName: matchData.crmName,
        clientId: matchData.clientId,
        crmDebt,
        excelClosing,
        gap,
        paymentTotal: gap,
        paymentsCreated: payments.length,
        dealsUpdated: dealUpdates.length,
        status: 'WILL_IMPORT',
      });
    }
  }

  // Report CRM-only clients (in CRM with debt but not in Excel)
  const processedIds = new Set(reconciliation.map(r => r.clientId));
  for (const [clientId, crm] of crmDebts) {
    if (!processedIds.has(clientId) && Math.abs(crm.net) > 1) {
      reconciliation.push({
        clientName: crm.name,
        clientId,
        crmDebt: crm.net,
        excelClosing: 0,
        gap: crm.net,
        paymentTotal: 0,
        paymentsCreated: 0,
        dealsUpdated: 0,
        status: 'CRM_ONLY',
      });
    }
  }

  // Sort: biggest gap first
  reconciliation.sort((a, b) => b.gap - a.gap);

  // ── Step 5: Output report ──
  console.log('\n' + '='.repeat(115));
  console.log('  RECONCILIATION TABLE');
  console.log('='.repeat(115));

  const hdr = [
    'Клиент'.padEnd(30),
    'Долг CRM'.padStart(16),
    'Остаток Excel'.padStart(16),
    'Разница'.padStart(16),
    'Платёж'.padStart(16),
    'Статус'.padStart(14),
  ].join(' | ');
  console.log(hdr);
  console.log('-'.repeat(115));

  const withAction = reconciliation.filter(r => Math.abs(r.gap) >= 1 || r.status !== 'OK');
  for (const r of withAction) {
    console.log([
      r.clientName.substring(0, 30).padEnd(30),
      fmtNum(r.crmDebt).padStart(16),
      fmtNum(r.excelClosing).padStart(16),
      fmtNum(r.gap).padStart(16),
      fmtNum(r.paymentTotal).padStart(16),
      r.status.padStart(14),
    ].join(' | '));
  }

  const matchedOk = reconciliation.filter(r => r.status === 'OK').length;
  if (matchedOk > 0) {
    console.log(`\n  + ${matchedOk} clients already in sync (gap < 1)`);
  }

  // ── Summary ──
  const currentDebtResult = await prisma.$queryRaw<{ gross: string; net: string }[]>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
      FROM deals d
      WHERE d.is_archived = false
    `
  );
  const currentGross = Number(currentDebtResult[0].gross);
  const currentNet = Number(currentDebtResult[0].net);

  console.log('\n' + '='.repeat(70));
  console.log('  SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Matched clients:             ${matched.size}`);
  console.log(`  Clients synced (OK):          ${matchedOk}`);
  console.log(`  Clients needing import:       ${clientsToImport}`);
  console.log(`  CRM-only (not in Excel):      ${reconciliation.filter(r => r.status === 'CRM_ONLY').length}`);
  console.log(`  Excel > CRM (skipped):        ${reconciliation.filter(r => r.status === 'EXCEL>CRM').length}`);
  console.log(`  Total payments to create:     ${totalPaymentsToCreate}`);
  console.log(`  Total gap to close:           ${fmtNum(totalGap)}`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Current CRM gross debt:       ${fmtNum(currentGross)}`);
  console.log(`  Current CRM net debt:         ${fmtNum(currentNet)}`);
  console.log(`  Excel total closing:          ${fmtNum(totalExcelClosing)}`);
  console.log(`  Expected net after sync:      ${fmtNum(currentNet - totalGap)}`);

  // ── CSV export ──
  const csvPath = path.resolve(process.cwd(), '..', `reconciliation-report-${Date.now()}.csv`);
  const csvLines = [
    'Клиент,Долг CRM,Остаток Excel,Разница,Платёж создан,Кол-во платежей,Статус',
    ...reconciliation.map(r =>
      `"${r.clientName.replace(/"/g, '""')}",${r.crmDebt},${r.excelClosing},${r.gap},${r.paymentTotal},${r.paymentsCreated},"${r.status}"`
    ),
  ];
  fs.writeFileSync(csvPath, '\uFEFF' + csvLines.join('\n'), 'utf8');
  console.log(`\n  CSV report saved: ${csvPath}`);

  // ── Result ──
  if (isExecute) {
    console.log(`\n  IMPORT COMPLETE: ${clientsImported} clients, ${clientErrors} errors`);

    // Post-import verification
    const postDebt = await prisma.$queryRaw<{ gross: string; net: string }[]>(
      Prisma.sql`
        SELECT
          COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
          COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
        FROM deals d
        WHERE d.is_archived = false
      `
    );
    console.log(`  Post-import gross debt: ${fmtNum(Number(postDebt[0].gross))}`);
    console.log(`  Post-import net debt:   ${fmtNum(Number(postDebt[0].net))}`);
  } else {
    console.log('\n  This was a DRY-RUN. To execute, run with --execute flag.');
  }
}

main()
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
