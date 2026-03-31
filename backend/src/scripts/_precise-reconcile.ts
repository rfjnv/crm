/**
 * Precise debt reconciliation: make CRM debts page match Excel J-filtered debt.
 *
 * For each CRM client with positive debt:
 *   - If client is in Excel with J-filtered debt → CRM should equal Excel
 *   - If client is NOT in Excel → CRM debt should be 0
 *
 * Creates reconciliation payments (FIFO) to close the gap.
 * Only handles cases where CRM > Excel (reduces debt).
 *
 * Run:
 *   npx tsx src/scripts/_precise-reconcile.ts            # dry-run
 *   npx tsx src/scripts/_precise-reconcile.ts --execute   # live
 */
import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();
const isExecute = process.argv.includes('--execute');

// J column debt types
const DEBT_TYPES = new Set(['к', 'н/к', 'п/к', 'ф']);

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

type Row = unknown[];

// ─────────── Step 1: Parse Excel with J filter ───────────

function parseExcelJFiltered(): Map<string, number> {
  const MONTH_NAMES = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ];

  const fpath = path.resolve(process.cwd(), '..', 'frontend', '05.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);

  // Collect ALL rows per client per sheet, then pick latest sheet
  const clientSheets = new Map<string, Map<number, Row[]>>();
  const balColBySheet = new Map<string, number>();

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.toLowerCase().trim();
    let monthIdx = -1;
    for (let m = 0; m < MONTH_NAMES.length; m++) {
      if (sn.startsWith(MONTH_NAMES[m])) { monthIdx = m; break; }
    }
    if (monthIdx < 0) continue;

    const yearMatch = sheetName.match(/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 2026;
    const monthKey = year * 12 + monthIdx;

    const ws = wb.Sheets[sheetName];
    const ref = ws['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const totalCols = range.e.c + 1;
    const balCol = totalCols - 2;  // balance column
    balColBySheet.set(sheetName, balCol);

    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

    for (let i = 3; i < data.length; i++) {
      const row = data[i] as Row;
      if (!row) continue;
      const clientRaw = row[1];
      if (!clientRaw || String(clientRaw).trim() === '') continue;

      const clientName = normalizeClientName(clientRaw);
      if (!clientName) continue;

      if (!clientSheets.has(clientName)) {
        clientSheets.set(clientName, new Map());
      }
      const sheets = clientSheets.get(clientName)!;
      if (!sheets.has(monthKey)) {
        sheets.set(monthKey, []);
      }
      sheets.get(monthKey)!.push(row);
    }
  }

  // For each client, take the LATEST sheet, then filter by J, sum balance
  const clientDebt = new Map<string, number>();

  for (const [clientName, sheets] of clientSheets) {
    const latestKey = Math.max(...sheets.keys());
    const rows = sheets.get(latestKey)!;

    // Determine balance column for this sheet
    // latestKey = year*12+month
    const year = Math.floor(latestKey / 12);
    const month = latestKey % 12;
    const sheetName = wb.SheetNames.find(sn => {
      const sLower = sn.toLowerCase().trim();
      return sLower.startsWith(MONTH_NAMES[month]) &&
        (sn.includes(String(year)) || (!sn.match(/\d{4}/) && year === 2026));
    });

    const balCol = sheetName ? (balColBySheet.get(sheetName) || 27) : 27;

    let total = 0;
    let hasDebtRows = false;

    for (const row of rows) {
      const jVal = row[9]; // column J (0-indexed = 9)
      const jStr = jVal != null ? String(jVal).trim().toLowerCase() : '';
      if (!DEBT_TYPES.has(jStr)) continue;

      const balance = numVal(row[balCol]);
      total += balance;
      hasDebtRows = true;
    }

    if (hasDebtRows) {
      clientDebt.set(clientName, total);
    }
  }

  return clientDebt;
}

// ─────────── Step 2: Get CRM debts per client ───────────

async function getCrmDebts(): Promise<Map<string, { clientId: string; name: string; debt: number; dealCount: number }>> {
  const deals = await prisma.deal.findMany({
    where: {
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    },
    include: { client: { select: { id: true, companyName: true } } },
  });

  const map = new Map<string, { clientId: string; name: string; debt: number; dealCount: number }>();

  for (const deal of deals) {
    const cid = deal.clientId;
    const debt = Number(deal.amount) - Number(deal.paidAmount);
    if (!map.has(cid)) {
      map.set(cid, {
        clientId: cid,
        name: deal.client?.companyName || cid,
        debt: 0,
        dealCount: 0,
      });
    }
    const entry = map.get(cid)!;
    entry.debt += debt;
    entry.dealCount++;
  }

  return map;
}

// ─────────── Step 3: FIFO allocate payment to reduce debt ───────────

async function fifoPayAndUpdate(
  clientId: string,
  paymentAmount: number,
  adminUserId: string,
): Promise<{ paymentsCreated: number; dealsUpdated: number }> {
  const deals = await prisma.deal.findMany({
    where: { clientId, isArchived: false, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, paidAmount: true },
  });

  if (deals.length === 0) return { paymentsCreated: 0, dealsUpdated: 0 };

  const slots = deals.map(d => ({
    dealId: d.id,
    amount: Number(d.amount),
    currentPaid: Number(d.paidAmount),
    remaining: Math.max(Number(d.amount) - Number(d.paidAmount), 0),
  }));

  let remaining = paymentAmount;
  const payments: { dealId: string; amount: number }[] = [];

  for (const slot of slots) {
    if (remaining <= 0.01) break;
    if (slot.remaining <= 0) continue;

    const allocate = Math.round(Math.min(remaining, slot.remaining) * 100) / 100;
    payments.push({ dealId: slot.dealId, amount: allocate });
    remaining -= allocate;
  }

  // If remaining > 0, put it on last deal
  if (remaining > 0.01 && slots.length > 0) {
    const lastSlot = slots[slots.length - 1];
    payments.push({ dealId: lastSlot.dealId, amount: Math.round(remaining * 100) / 100 });
  }

  const now = new Date();
  const note = 'Сверка CRM-Excel: корректировка (март 2026)';

  await prisma.$transaction(async (tx) => {
    for (const p of payments) {
      await tx.payment.create({
        data: {
          dealId: p.dealId,
          clientId,
          amount: p.amount,
          method: 'TRANSFER',
          paidAt: now,
          createdBy: adminUserId,
          note,
          createdAt: now,
        },
      });

      // Get current deal state
      const deal = await tx.deal.findUnique({ where: { id: p.dealId }, select: { amount: true, paidAmount: true } });
      if (deal) {
        const newPaid = Math.round((Number(deal.paidAmount) + p.amount) * 100) / 100;
        const newStatus = computePaymentStatus(newPaid, Number(deal.amount));
        await tx.deal.update({
          where: { id: p.dealId },
          data: { paidAmount: newPaid, paymentStatus: newStatus as any },
        });
      }
    }
  }, { maxWait: 30000, timeout: 60000 });

  return { paymentsCreated: payments.length, dealsUpdated: payments.length };
}

// ─────────── main ───────────

async function main() {
  console.log('='.repeat(80));
  console.log(`  PRECISE DEBT RECONCILIATION  ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(80));

  // Find admin
  const adminUser = await prisma.user.findFirst({
    where: { OR: [{ login: 'admin' }, { role: 'SUPER_ADMIN' }] },
    select: { id: true },
  });
  if (!adminUser) { console.error('No admin user'); process.exit(1); }

  // Step 1: Parse Excel with J filter
  console.log('\n[1/3] Parsing Excel (J filter: к, н/к, п/к, ф)...');
  const excelDebt = parseExcelJFiltered();
  console.log(`  Excel clients with J-filtered debt data: ${excelDebt.size}`);
  let excelTotal = 0;
  for (const [, d] of excelDebt) if (d > 0) excelTotal += d;
  console.log(`  Excel total positive debt: ${fmtNum(excelTotal)}`);

  // Step 2: Get CRM debts
  console.log('\n[2/3] Loading CRM debts...');
  const crmDebts = await getCrmDebts();

  // Build CRM normalized name lookup
  const allClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const crmNormToId = new Map<string, string>();
  const crmIdToNorm = new Map<string, string>();
  for (const c of allClients) {
    const norm = normalizeClientName(c.companyName);
    crmNormToId.set(norm, c.id);
    crmIdToNorm.set(c.id, norm);
  }

  // Step 3: Reconcile
  console.log('\n[3/3] Reconciling...\n');

  let totalReduction = 0;
  let clientsToFix = 0;
  let clientsFixed = 0;
  let totalPayments = 0;

  const rows: { name: string; crmDebt: number; excelDebt: number; gap: number; status: string }[] = [];

  // Only process CRM clients with POSITIVE debt
  const positiveDebtClients = [...crmDebts.entries()].filter(([, v]) => v.debt > 0);

  for (const [clientId, crm] of positiveDebtClients) {
    const normName = crmIdToNorm.get(clientId) || '';
    const excelVal = excelDebt.get(normName);
    const excelTarget = excelVal !== undefined ? Math.max(excelVal, 0) : 0;

    const gap = crm.debt - excelTarget;

    if (gap < 1) {
      // CRM matches or is less than Excel — skip
      rows.push({ name: crm.name, crmDebt: crm.debt, excelDebt: excelTarget, gap, status: 'OK' });
      continue;
    }

    // CRM > Excel → need to reduce CRM by gap
    totalReduction += gap;
    clientsToFix++;

    if (isExecute) {
      try {
        const result = await fifoPayAndUpdate(clientId, gap, adminUser.id);
        clientsFixed++;
        totalPayments += result.paymentsCreated;
        rows.push({ name: crm.name, crmDebt: crm.debt, excelDebt: excelTarget, gap, status: 'FIXED' });
      } catch (err) {
        rows.push({ name: crm.name, crmDebt: crm.debt, excelDebt: excelTarget, gap, status: 'ERROR' });
        console.error(`  ERROR [${crm.name}]: ${(err as Error).message.slice(0, 80)}`);
      }
    } else {
      rows.push({ name: crm.name, crmDebt: crm.debt, excelDebt: excelTarget, gap, status: 'WILL_FIX' });
    }
  }

  // Sort by gap desc
  rows.sort((a, b) => b.gap - a.gap);

  // Print
  const needsAction = rows.filter(r => r.status !== 'OK');
  console.log(`${'Клиент'.padEnd(35)} ${'CRM Долг'.padStart(18)} ${'Excel Долг'.padStart(18)} ${'Разница'.padStart(18)} ${'Статус'.padStart(10)}`);
  console.log('─'.repeat(105));

  for (const r of needsAction) {
    console.log(
      `${r.name.substring(0, 35).padEnd(35)} ${fmtNum(r.crmDebt).padStart(18)} ${fmtNum(r.excelDebt).padStart(18)} ${fmtNum(r.gap).padStart(18)} ${r.status.padStart(10)}`
    );
  }

  const okCount = rows.filter(r => r.status === 'OK').length;
  console.log(`\n  + ${okCount} clients already match Excel`);

  // Current total
  const postDeals = await prisma.deal.findMany({
    where: {
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    },
    select: { amount: true, paidAmount: true },
  });
  let postGross = 0;
  for (const d of postDeals) {
    const debt = Number(d.amount) - Number(d.paidAmount);
    if (debt > 0) postGross += debt;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`  Clients to fix: ${clientsToFix}`);
  console.log(`  Total reduction: ${fmtNum(totalReduction)}`);
  console.log(`  Current CRM debt: ${fmtNum(postGross)}`);
  console.log(`  Expected after fix: ${fmtNum(postGross - totalReduction)}`);
  console.log(`  Excel target: ${fmtNum(excelTotal)}`);

  if (isExecute) {
    console.log(`\n  DONE: ${clientsFixed} clients fixed, ${totalPayments} payments created`);
    console.log(`  Post-fix CRM debt: ${fmtNum(postGross)}`);
  } else {
    console.log('\n  DRY-RUN. Use --execute to apply.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
