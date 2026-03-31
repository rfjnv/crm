/**
 * Import 2024 data from 26.12.2024.xlsx into CRM.
 *
 * What it does:
 * 1. Parses all 12 monthly sheets from the 2024 Excel
 * 2. Extracts per-client, per-month payment amounts by method
 * 3. Matches clients to CRM (creates new ones if missing)
 * 4. For clients without deals, creates a summary deal
 * 5. Calculates deficit (Excel total - CRM existing payments in 2024)
 * 6. Creates payments via FIFO allocation to deals
 *
 * Run:
 *   cd backend && npx tsx src/scripts/_import-2024.ts            # dry-run
 *   cd backend && npx tsx src/scripts/_import-2024.ts --execute   # live
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const FILE_2024 = path.resolve(__dirname, '../../../26.12.2024.xlsx');
const EXECUTE = process.argv.includes('--execute');

// ───────── helpers ─────────

function norm(v: any): string {
  if (v == null) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

function normLower(v: string): string {
  return v.toLowerCase().trim().replace(/\s+/g, ' ');
}

function numVal(v: any): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

// ───────── Step 1: Parse 2024 Excel ─────────

interface ExcelPayment {
  amount: number;
  method: string;
  month: number;
  year: number;
  paidAt: Date;
}

interface ClientExcelData {
  payments: ExcelPayment[];
  totalPaid: number;
  // Track closing balance from last month
  closingBalance: number;
  openingBalance: number;
}

/**
 * Dynamically detect payment method columns from header rows.
 * Returns column indices for the "current month" payment (middle of triplet).
 */
function detectPaymentCols(rows: any[][]): { col: number; method: string }[] {
  const row1 = (rows[1] || []).map((v: any) => normLower(norm(v)));
  const result: { col: number; method: string }[] = [];

  for (let c = 0; c < row1.length; c++) {
    const h = row1[c];
    if (h.includes('накд')) {
      result.push({ col: c + 1, method: 'CASH' }); // current month is col+1
    } else if (h === 'пер' || h.startsWith('пер') && !h.includes('перечисл')) {
      result.push({ col: c + 1, method: 'TRANSFER' });
    } else if (h.includes('qr') || h === '#') {
      // In Jan 2024, QR is labeled "#" at col 20
      // Check if this "#" is in the payment section (after col 10)
      if (h === '#' && c < 10) continue; // Skip "#" in the product section
      result.push({ col: c + 1, method: 'QR' });
    } else if (h.includes('пластик') || h.includes('клик')) {
      result.push({ col: c + 1, method: 'CLICK' });
    } else if (h.includes('терминал')) {
      result.push({ col: c + 1, method: 'TERMINAL' });
    }
  }

  return result;
}

/**
 * Detect the closing balance column.
 * It's typically the last or 2nd-to-last data column, labeled "остаток сум".
 */
function detectCloseBalCol(rows: any[][], totalCols: number): number {
  const row0 = (rows[0] || []).map((v: any) => normLower(norm(v)));
  const row1 = (rows[1] || []).map((v: any) => normLower(norm(v)));

  // Look backwards from the end for "ост"
  for (let c = totalCols - 1; c >= totalCols - 4; c--) {
    const h0 = row0[c] || '';
    const h1 = row1[c] || '';
    if (h0.includes('ост') || h1.includes('остаток')) {
      // If next col also has "сум", use that
      if (row1[c + 1] && normLower(norm(row1[c + 1])).includes('сум')) {
        return c + 1;
      }
      return c;
    }
  }

  // Fallback: 2nd-to-last
  return totalCols - 2;
}

function parseExcel2024(): Map<string, ClientExcelData> {
  const wb = XLSX.readFile(FILE_2024);
  const clientMap = new Map<string, ClientExcelData>();

  console.log(`  Reading ${path.basename(FILE_2024)} (${wb.SheetNames.length} sheets)`);

  for (let sheetIdx = 0; sheetIdx < Math.min(wb.SheetNames.length, 12); sheetIdx++) {
    const sheetName = wb.SheetNames[sheetIdx];
    const sn = sheetName.toLowerCase().trim();

    // Detect month
    let monthIdx = -1;
    for (let m = 0; m < MONTH_NAMES.length; m++) {
      if (sn.startsWith(MONTH_NAMES[m])) { monthIdx = m; break; }
    }
    if (monthIdx < 0) {
      console.log(`    Skipping sheet "${sheetName}"`);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;

    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const range = XLSX.utils.decode_range(ws['!ref']!);
    const totalCols = range.e.c + 1;

    // Dynamic column detection
    const paymentCols = detectPaymentCols(rows);
    const closeBalCol = detectCloseBalCol(rows, totalCols);

    const paidAt = new Date(Date.UTC(2024, monthIdx, 15));

    let sheetPayments = 0;
    let sheetTotal = 0;

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;

      const rawName = norm(row[1]);
      if (!rawName || rawName.length < 2) continue;
      const lower = rawName.toLowerCase();
      if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого' || lower === 'всего') continue;

      const key = normLower(rawName);
      const closeBal = numVal(row[closeBalCol]);

      for (const pc of paymentCols) {
        const amt = numVal(row[pc.col]);
        if (amt > 0) {
          if (!clientMap.has(key)) {
            clientMap.set(key, { payments: [], totalPaid: 0, closingBalance: 0, openingBalance: 0 });
          }
          const cd = clientMap.get(key)!;
          cd.payments.push({ amount: amt, method: pc.method, month: monthIdx, year: 2024, paidAt });
          cd.totalPaid += amt;
          sheetPayments++;
          sheetTotal += amt;
        }
      }

      // Track closing balance from the last month this client appears in
      if (clientMap.has(key)) {
        const cd = clientMap.get(key)!;
        if (closeBal > 0) cd.closingBalance = closeBal;
      }
    }

    console.log(`    ${sheetName}: ${paymentCols.length} methods, ${sheetPayments} payment rows, ${sheetTotal.toLocaleString()} UZS`);
  }

  return clientMap;
}

// ───────── Step 2: Match clients ─────────

async function matchClients(excelClients: Map<string, ClientExcelData>): Promise<{
  matched: Map<string, { clientId: string; crmName: string }>;
  unmatched: string[];
}> {
  const allCrm = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const crmNorm = new Map<string, { id: string; name: string }>();
  for (const c of allCrm) {
    crmNorm.set(normLower(c.companyName), { id: c.id, name: c.companyName });
  }

  const matched = new Map<string, { clientId: string; crmName: string }>();
  const unmatched: string[] = [];

  // Pass 1: exact match
  for (const excelKey of excelClients.keys()) {
    if (crmNorm.has(excelKey)) {
      matched.set(excelKey, { clientId: crmNorm.get(excelKey)!.id, crmName: crmNorm.get(excelKey)!.name });
    }
  }

  // Pass 2: fuzzy match
  const usedIds = new Set([...matched.values()].map(m => m.clientId));
  for (const excelKey of excelClients.keys()) {
    if (matched.has(excelKey)) continue;

    let best: { id: string; name: string } | null = null;
    let bestLen = 0;

    for (const [crmKey, crmVal] of crmNorm) {
      if (usedIds.has(crmVal.id)) continue;
      const isPrefix = crmKey.startsWith(excelKey) || excelKey.startsWith(crmKey);
      const isSubstring = (excelKey.length >= 5 && crmKey.includes(excelKey)) ||
                          (crmKey.length >= 5 && excelKey.includes(crmKey));
      if (isPrefix || isSubstring) {
        const len = Math.min(excelKey.length, crmKey.length);
        if (len > bestLen) { bestLen = len; best = crmVal; }
      }
    }

    if (best && bestLen >= 3) {
      matched.set(excelKey, { clientId: best.id, crmName: best.name });
      usedIds.add(best.id);
    } else {
      unmatched.push(excelKey);
    }
  }

  return { matched, unmatched };
}

// ───────── Step 3: Create missing clients ─────────

async function createMissingClients(
  unmatchedKeys: string[],
  excelClients: Map<string, ClientExcelData>,
  adminUserId: string,
): Promise<Map<string, { clientId: string; crmName: string }>> {
  const created = new Map<string, { clientId: string; crmName: string }>();

  for (const key of unmatchedKeys) {
    const data = excelClients.get(key)!;
    if (data.totalPaid <= 0) continue; // Skip clients with no payments

    const name = key; // use normalized name
    const properName = name.charAt(0).toUpperCase() + name.slice(1);

    if (EXECUTE) {
      // Check if client was already created (idempotent)
      const existing = await prisma.client.findFirst({
        where: { companyName: { equals: properName, mode: 'insensitive' } },
        select: { id: true, companyName: true },
      });
      if (existing) {
        created.set(key, { clientId: existing.id, crmName: existing.companyName });
        continue;
      }
      const client = await prisma.client.create({
        data: {
          companyName: properName,
          contactName: properName,
          phone: '',
          address: '',
          managerId: adminUserId,
        },
      });
      created.set(key, { clientId: client.id, crmName: properName });
    } else {
      created.set(key, { clientId: `NEW-${key}`, crmName: properName });
    }
  }

  return created;
}

// ───────── Step 4: Create deals for clients without existing deals ─────────

async function ensureDeals(
  clientId: string,
  clientName: string,
  excelData: ClientExcelData,
  adminUserId: string,
): Promise<string> {
  // Check if client has existing deals
  const dealCount = await prisma.deal.count({ where: { clientId, isArchived: false } });

  if (dealCount > 0) {
    // Use existing deals
    const firstDeal = await prisma.deal.findFirst({
      where: { clientId, isArchived: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return firstDeal!.id;
  }

  // Create a single summary deal for 2024
  if (EXECUTE) {
    const deal = await prisma.deal.create({
      data: {
        title: `${clientName} — Импорт 2024`,
        clientId,
        managerId: adminUserId,
        status: 'CLOSED',
        amount: excelData.totalPaid,
        paidAmount: 0, // will be updated during payment import
        paymentStatus: 'UNPAID',
        paymentType: 'FULL',
        createdAt: new Date(Date.UTC(2024, 0, 1)),
      },
    });
    return deal.id;
  }

  return `NEW-DEAL-${clientName}`;
}

// ───────── Step 5: Reconcile and import payments ─────────

interface PaymentToCreate {
  dealId: string;
  clientId: string;
  amount: number;
  method: string;
  paidAt: Date;
  note: string;
}

async function reconcileAndImport(
  clientId: string,
  clientName: string,
  excelData: ClientExcelData,
  adminUserId: string,
): Promise<{ newPayments: number; newAmount: number; deficit: number }> {
  // Get existing CRM payments for this client in 2024
  // Include both regular payments AND any "Импорт 2024" payments already created
  const existingPayments = await prisma.payment.findMany({
    where: {
      clientId,
      OR: [
        { paidAt: { gte: new Date(Date.UTC(2024, 0, 1)), lt: new Date(Date.UTC(2025, 0, 1)) } },
        { note: { startsWith: 'Импорт 2024:' } },
      ],
    },
    select: { amount: true },
  });
  const crmTotal2024 = existingPayments.reduce((s, p) => s + Number(p.amount), 0);
  const deficit = excelData.totalPaid - crmTotal2024;

  if (deficit <= 0) {
    return { newPayments: 0, newAmount: 0, deficit };
  }

  // Get deals for FIFO allocation
  const deals = await prisma.deal.findMany({
    where: { clientId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, paidAmount: true },
  });

  if (deals.length === 0) {
    // Need to create a deal first
    const dealId = await ensureDeals(clientId, clientName, excelData, adminUserId);
    deals.push({ id: dealId, amount: new Prisma.Decimal(excelData.totalPaid), paidAmount: new Prisma.Decimal(0) });
  }

  // Sort Excel payments chronologically
  const sortedPayments = [...excelData.payments].sort((a, b) => a.month - b.month);

  // Skip payments already covered by CRM
  let remaining = crmTotal2024;
  const newPayments: ExcelPayment[] = [];
  for (const ep of sortedPayments) {
    if (remaining >= ep.amount) {
      remaining -= ep.amount;
    } else if (remaining > 0) {
      newPayments.push({ ...ep, amount: ep.amount - remaining });
      remaining = 0;
    } else {
      newPayments.push(ep);
    }
  }

  // FIFO allocation to deals
  const dealDebts = deals.map(d => ({
    dealId: d.id,
    amount: Number(d.amount),
    paid: Number(d.paidAmount),
    remaining: Math.max(Number(d.amount) - Number(d.paidAmount), 0),
    added: 0,
  }));

  const toCreate: PaymentToCreate[] = [];
  let dealIdx = 0;

  for (const ep of newPayments) {
    let left = ep.amount;
    while (left > 0) {
      while (dealIdx < dealDebts.length && dealDebts[dealIdx].remaining <= 0) dealIdx++;

      if (dealIdx >= dealDebts.length) {
        // Overpayment — add to last deal
        const last = dealDebts[dealDebts.length - 1];
        toCreate.push({
          dealId: last.dealId,
          clientId,
          amount: left,
          method: ep.method,
          paidAt: ep.paidAt,
          note: `Импорт 2024: ${MONTH_NAMES_RU[ep.month]}`,
        });
        last.added += left;
        left = 0;
        break;
      }

      const deal = dealDebts[dealIdx];
      const allocate = Math.min(left, deal.remaining);
      toCreate.push({
        dealId: deal.dealId,
        clientId,
        amount: allocate,
        method: ep.method,
        paidAt: ep.paidAt,
        note: `Импорт 2024: ${MONTH_NAMES_RU[ep.month]}`,
      });
      deal.remaining -= allocate;
      deal.added += allocate;
      left -= allocate;
    }
  }

  // Execute — no transaction (large batches time out)
  if (EXECUTE && toCreate.length > 0) {
    for (const p of toCreate) {
      await prisma.payment.create({
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

    // Update deal paid amounts
    for (const dd of dealDebts) {
      if (dd.added > 0) {
        const newPaid = dd.paid + dd.added;
        const newStatus = newPaid >= dd.amount ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'UNPAID');
        await prisma.deal.updateMany({
          where: { id: dd.dealId },
          data: { paidAmount: newPaid, paymentStatus: newStatus as any },
        });
      }
    }
  }

  return { newPayments: toCreate.length, newAmount: deficit, deficit };
}

// ───────── main ─────────

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log(`  IMPORT 2024 DATA   ${EXECUTE ? '** LIVE **' : '(DRY RUN)'}`);
  console.log('='.repeat(80));

  // Find admin user
  const adminUser = await prisma.user.findFirst({
    where: { OR: [{ login: 'admin' }, { role: 'SUPER_ADMIN' }] },
    select: { id: true, login: true },
  });
  if (!adminUser) { console.error('No admin user found'); process.exit(1); }
  console.log(`\nAdmin: ${adminUser.login}`);

  // Step 1: Parse Excel
  console.log('\n[1/5] Parsing 2024 Excel...');
  const excelClients = parseExcel2024();
  let grandTotal = 0;
  for (const [, cd] of excelClients) grandTotal += cd.totalPaid;
  console.log(`\n  Total Excel clients: ${excelClients.size}`);
  console.log(`  Grand total payments: ${grandTotal.toLocaleString()} UZS`);

  // Step 2: Match clients
  console.log('\n[2/5] Matching clients to CRM...');
  const { matched, unmatched } = await matchClients(excelClients);
  console.log(`  Matched: ${matched.size}`);
  console.log(`  Unmatched: ${unmatched.length}`);

  // Step 3: Create missing clients
  let newClients = new Map<string, { clientId: string; crmName: string }>();
  if (unmatched.length > 0) {
    console.log('\n[3/5] Creating missing clients...');
    newClients = await createMissingClients(unmatched, excelClients, adminUser.id);
    console.log(`  Created: ${newClients.size}`);
    for (const [key, val] of newClients) {
      console.log(`    + ${val.crmName} (payments: ${excelClients.get(key)!.totalPaid.toLocaleString()})`);
    }
  } else {
    console.log('\n[3/5] All clients matched, no new clients needed.');
  }

  // Combine matched + new clients
  const allMatched = new Map([...matched, ...newClients]);

  // Step 4: Reconcile & import
  console.log('\n[4/5] Reconciling payments...');
  let totalNew = 0;
  let totalAmount = 0;
  let clientsWithDeficit = 0;
  let clientsNoDeficit = 0;

  const deficitReport: { name: string; crmExisting: number; excelTotal: number; deficit: number; newPmts: number }[] = [];

  let processed = 0;
  for (const [excelKey, match] of allMatched) {
    const excelData = excelClients.get(excelKey)!;
    processed++;

    if (EXECUTE) {
      // Ensure deal exists
      await ensureDeals(match.clientId, match.crmName, excelData, adminUser.id);
    }

    const result = await reconcileAndImport(match.clientId, match.crmName, excelData, adminUser.id);

    if (result.deficit > 0) {
      totalNew += result.newPayments;
      totalAmount += result.newAmount;
      clientsWithDeficit++;
      deficitReport.push({
        name: match.crmName,
        crmExisting: excelData.totalPaid - result.deficit,
        excelTotal: excelData.totalPaid,
        deficit: result.deficit,
        newPmts: result.newPayments,
      });
    } else {
      clientsNoDeficit++;
    }

    if (processed % 50 === 0) console.log(`  ... processed ${processed}/${allMatched.size}`);
  }

  // Report
  console.log('\n' + '='.repeat(110));
  console.log('  RECONCILIATION REPORT');
  console.log('='.repeat(110));

  deficitReport.sort((a, b) => b.deficit - a.deficit);

  console.log(`\n${'Client'.padEnd(35)} | ${'CRM 2024'.padStart(14)} | ${'Excel 2024'.padStart(14)} | ${'Deficit'.padStart(14)} | ${'New Pmts'.padStart(8)}`);
  console.log('─'.repeat(95));

  for (const r of deficitReport.slice(0, 50)) {
    console.log(
      `${r.name.substring(0, 35).padEnd(35)} | ` +
      `${r.crmExisting.toLocaleString().padStart(14)} | ` +
      `${r.excelTotal.toLocaleString().padStart(14)} | ` +
      `${r.deficit.toLocaleString().padStart(14)} | ` +
      `${String(r.newPmts).padStart(8)}`
    );
  }
  if (deficitReport.length > 50) console.log(`  ... and ${deficitReport.length - 50} more`);

  // Step 5: Summary
  console.log('\n' + '='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Total Excel clients:        ${excelClients.size}`);
  console.log(`  Matched to CRM:             ${matched.size}`);
  console.log(`  New clients created:         ${newClients.size}`);
  console.log(`  Clients with deficit:        ${clientsWithDeficit}`);
  console.log(`  Clients fully covered:       ${clientsNoDeficit}`);
  console.log(`  New payments to create:      ${totalNew}`);
  console.log(`  Total deficit to import:     ${totalAmount.toLocaleString()} UZS`);

  // Current DB state
  const dbStats = await prisma.$queryRaw<{ payments: string; total: string }[]>(
    Prisma.sql`SELECT COUNT(*)::text as payments, COALESCE(SUM(amount),0)::text as total FROM payments WHERE paid_at >= '2024-01-01' AND paid_at < '2025-01-01'`
  );
  console.log(`\n  Current CRM 2024 payments:   ${dbStats[0].payments} (${Number(dbStats[0].total).toLocaleString()} UZS)`);

  if (EXECUTE) {
    const afterStats = await prisma.$queryRaw<{ payments: string; total: string }[]>(
      Prisma.sql`SELECT COUNT(*)::text as payments, COALESCE(SUM(amount),0)::text as total FROM payments WHERE paid_at >= '2024-01-01' AND paid_at < '2025-01-01'`
    );
    console.log(`  After import 2024 payments:  ${afterStats[0].payments} (${Number(afterStats[0].total).toLocaleString()} UZS)`);
  } else {
    console.log(`\n  This is a DRY RUN. Use --execute to apply changes.`);
  }
}

main()
  .catch(err => { console.error('FAILED:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
