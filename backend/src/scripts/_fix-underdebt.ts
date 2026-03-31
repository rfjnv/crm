/**
 * Fix under-debt clients: where CRM debt < Excel J-filtered debt.
 *
 * For these clients, previous sync over-corrected their debt.
 * We need to INCREASE their CRM debt by removing excess reconciliation payments
 * and reducing paidAmount on their deals.
 *
 * Run:
 *   npx tsx src/scripts/_fix-underdebt.ts            # dry-run
 *   npx tsx src/scripts/_fix-underdebt.ts --execute   # live
 */
import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();
const isExecute = process.argv.includes('--execute');

const DEBT_TYPES = new Set(['к', 'н/к', 'п/к', 'ф']);
const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

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

// ─────────── Parse Excel with J filter ───────────

function parseExcelJFiltered(): Map<string, number> {
  const fpath = path.resolve(process.cwd(), '..', 'frontend', '05.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);

  const clientSheets = new Map<string, Map<number, { rows: Row[]; balCol: number }>>();

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
    const balCol = range.e.c - 1; // second-to-last column

    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

    for (let i = 3; i < data.length; i++) {
      const row = data[i] as Row;
      if (!row) continue;
      const clientRaw = row[1];
      if (!clientRaw || String(clientRaw).trim() === '') continue;

      const clientName = normalizeClientName(clientRaw);
      if (!clientName) continue;

      if (!clientSheets.has(clientName)) clientSheets.set(clientName, new Map());
      const sheets = clientSheets.get(clientName)!;
      if (!sheets.has(monthKey)) sheets.set(monthKey, { rows: [], balCol });
      sheets.get(monthKey)!.rows.push(row);
    }
  }

  // For each client: latest sheet → filter by J → sum balance
  const clientDebt = new Map<string, number>();

  for (const [clientName, sheets] of clientSheets) {
    const latestKey = Math.max(...sheets.keys());
    const { rows, balCol } = sheets.get(latestKey)!;

    let total = 0;
    for (const row of rows) {
      const jVal = row[9];
      const jStr = jVal != null ? String(jVal).trim().toLowerCase() : '';
      if (!DEBT_TYPES.has(jStr)) continue;
      total += numVal(row[balCol]);
    }

    clientDebt.set(clientName, total);
  }

  return clientDebt;
}

// ─────────── Main ───────────

async function main() {
  console.log('='.repeat(80));
  console.log(`  FIX UNDER-DEBT CLIENTS  ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(80));

  // Parse Excel
  console.log('\n[1/3] Parsing Excel (J filter: к, н/к, п/к, ф)...');
  const excelDebt = parseExcelJFiltered();
  let excelTotal = 0;
  for (const [, d] of excelDebt) if (d > 0) excelTotal += d;
  console.log(`  Excel target total: ${fmtNum(excelTotal)}`);

  // Build CRM client lookup
  const allClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const crmNormToId = new Map<string, { id: string; name: string }>();
  for (const c of allClients) {
    const norm = normalizeClientName(c.companyName);
    crmNormToId.set(norm, { id: c.id, name: c.companyName });
  }

  // Get CRM debts per client (gross, from debts page formula)
  console.log('\n[2/3] Loading CRM debts...');
  const deals = await prisma.deal.findMany({
    where: {
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    },
    include: { client: { select: { id: true, companyName: true } } },
  });

  // Per-client CRM gross debt (only UNPAID/PARTIAL deals contribute)
  const crmDebtByClient = new Map<string, number>();
  for (const d of deals) {
    if (d.paymentStatus === 'UNPAID' || d.paymentStatus === 'PARTIAL') {
      const debt = Number(d.amount) - Number(d.paidAmount);
      if (debt > 0) {
        crmDebtByClient.set(d.clientId, (crmDebtByClient.get(d.clientId) || 0) + debt);
      }
    }
  }

  // Find under-debt clients: CRM < Excel
  console.log('\n[3/3] Finding under-debt clients...\n');

  let totalIncrease = 0;
  let clientsToFix = 0;
  let clientsFixed = 0;

  const rows: { name: string; crmDebt: number; excelDebt: number; gap: number; status: string }[] = [];

  for (const [normName, excelTarget] of excelDebt) {
    if (excelTarget <= 0) continue;

    const crmClient = crmNormToId.get(normName);
    if (!crmClient) continue;

    const crmDebt = crmDebtByClient.get(crmClient.id) || 0;
    const gap = excelTarget - crmDebt;

    if (gap < 1) continue; // CRM >= Excel, skip

    totalIncrease += gap;
    clientsToFix++;

    if (isExecute) {
      try {
        // Find reconciliation payments to delete/reduce
        const reconPayments = await prisma.payment.findMany({
          where: {
            clientId: crmClient.id,
            note: { contains: 'Сверка' },
          },
          orderBy: { createdAt: 'desc' },
          include: { deal: { select: { id: true, amount: true, paidAmount: true } } },
        });

        let remaining = gap;

        for (const payment of reconPayments) {
          if (remaining <= 0.01) break;

          const paymentAmount = Number(payment.amount);
          const removeAmount = Math.min(remaining, paymentAmount);

          if (removeAmount >= paymentAmount - 0.01) {
            // Delete entire payment
            await prisma.payment.delete({ where: { id: payment.id } });

            // Reduce deal.paidAmount
            if (payment.deal) {
              const newPaid = Math.max(0, Math.round((Number(payment.deal.paidAmount) - paymentAmount) * 100) / 100);
              const newStatus = computePaymentStatus(newPaid, Number(payment.deal.amount));
              await prisma.deal.update({
                where: { id: payment.deal.id },
                data: { paidAmount: newPaid, paymentStatus: newStatus as any },
              });
            }

            remaining -= paymentAmount;
          } else {
            // Reduce payment amount
            const newPaymentAmount = Math.round((paymentAmount - removeAmount) * 100) / 100;
            await prisma.payment.update({
              where: { id: payment.id },
              data: { amount: newPaymentAmount },
            });

            // Reduce deal.paidAmount
            if (payment.deal) {
              const newPaid = Math.max(0, Math.round((Number(payment.deal.paidAmount) - removeAmount) * 100) / 100);
              const newStatus = computePaymentStatus(newPaid, Number(payment.deal.amount));
              await prisma.deal.update({
                where: { id: payment.deal.id },
                data: { paidAmount: newPaid, paymentStatus: newStatus as any },
              });
            }

            remaining -= removeAmount;
          }
        }

        // If still remaining (not enough recon payments), reduce paidAmount on deals directly
        if (remaining > 0.5) {
          const clientDeals = await prisma.deal.findMany({
            where: { clientId: crmClient.id, isArchived: false },
            orderBy: { createdAt: 'desc' }, // newest first
            select: { id: true, amount: true, paidAmount: true },
          });

          for (const deal of clientDeals) {
            if (remaining <= 0.01) break;
            const paid = Number(deal.paidAmount);
            if (paid <= 0) continue;

            const reduce = Math.min(remaining, paid);
            const newPaid = Math.round((paid - reduce) * 100) / 100;
            const newStatus = computePaymentStatus(newPaid, Number(deal.amount));

            await prisma.deal.update({
              where: { id: deal.id },
              data: { paidAmount: newPaid, paymentStatus: newStatus as any },
            });

            remaining -= reduce;
          }
        }

        clientsFixed++;
        rows.push({ name: crmClient.name, crmDebt, excelDebt: excelTarget, gap, status: 'FIXED' });
      } catch (err) {
        rows.push({ name: crmClient.name, crmDebt, excelDebt: excelTarget, gap, status: 'ERROR' });
        console.error(`  ERROR [${crmClient.name}]: ${(err as Error).message.slice(0, 80)}`);
      }
    } else {
      rows.push({ name: crmClient.name, crmDebt, excelDebt: excelTarget, gap, status: 'WILL_FIX' });
    }
  }

  // Sort by gap desc
  rows.sort((a, b) => b.gap - a.gap);

  // Print
  console.log(`${'Клиент'.padEnd(35)} ${'CRM долг'.padStart(18)} ${'Excel долг'.padStart(18)} ${'Нехватка'.padStart(18)} ${'Статус'.padStart(10)}`);
  console.log('─'.repeat(105));
  for (const r of rows) {
    console.log(
      `${r.name.substring(0, 35).padEnd(35)} ${fmtNum(r.crmDebt).padStart(18)} ${fmtNum(r.excelDebt).padStart(18)} ${fmtNum(r.gap).padStart(18)} ${r.status.padStart(10)}`
    );
  }

  // Verify
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
  console.log(`  Total debt to restore: ${fmtNum(totalIncrease)}`);
  console.log(`  CRM debt now: ${fmtNum(postGross)}`);
  console.log(`  Excel target: ${fmtNum(excelTotal)}`);
  console.log(`  Difference: ${fmtNum(postGross - excelTotal)}`);

  if (isExecute) {
    console.log(`\n  DONE: ${clientsFixed} clients fixed`);
  } else {
    console.log('\n  DRY-RUN. Use --execute to apply.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
