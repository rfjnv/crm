/**
 * Fix bad-date payments (1899, 1903, etc.) using 2024 Excel data.
 *
 * Strategy:
 * 1. Match bad-date payments to 2024 Excel by client name
 * 2. For matched clients: aggregate Excel monthly totals per payment method,
 *    then assign CRM payments to correct months using amount matching
 * 3. For unmatched clients: fall back to deal.created_at
 *
 * Run:
 *   DRY RUN:  cd backend && npx tsx src/scripts/_fix-bad-dates-2024.ts
 *   EXECUTE:  cd backend && npx tsx src/scripts/_fix-bad-dates-2024.ts --execute
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const FILE_2024 = path.resolve(__dirname, '../../../26.12.2024.xlsx');
const EXECUTE = process.argv.includes('--execute');

function norm(v: any): string {
  if (v == null) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

function normLower(v: string): string {
  return v.toLowerCase().trim().replace(/\s+/g, ' ');
}

function numVal(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

// Map CRM payment method to Excel column group
const METHOD_MAP: Record<string, string> = {
  CASH: 'cash',
  TRANSFER: 'transfer',
  QR: 'qr',
  CLICK: 'click',
  TERMINAL: 'terminal',
  PAYME: 'cash', // fallback
  INSTALLMENT: 'transfer', // fallback
};

interface MonthPayment {
  month: number; // 0-11
  amounts: { cash: number; transfer: number; qr: number; click: number; terminal: number; total: number };
}

/**
 * Extract per-client, per-month payment totals from 2024 Excel.
 * For each client, aggregate all row payments into monthly totals.
 */
function extractMonthlyTotals(): Map<string, MonthPayment[]> {
  const wb = XLSX.readFile(FILE_2024);
  const result = new Map<string, MonthPayment[]>();

  for (let m = 0; m < Math.min(wb.SheetNames.length, 12); m++) {
    const ws = wb.Sheets[wb.SheetNames[m]];
    if (!ws || !ws['!ref']) continue;

    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const row1 = (rows[1] || []).map((v: any) => normLower(norm(v)));
    const range = XLSX.utils.decode_range(ws['!ref']!);
    const totalCols = range.e.c + 1;

    // Find payment method columns by scanning row 1
    let cashCol = -1, transferCol = -1, qrCol = -1, clickCol = -1, terminalCol = -1;

    for (let c = 0; c < totalCols; c++) {
      const h = row1[c] || '';
      if (h.includes('накд')) cashCol = c;
      else if (h.includes('пер') && !h.includes('перечисл')) transferCol = c;
      else if (h.includes('qr')) qrCol = c;
      else if (h.includes('пластик') || h.includes('клик')) clickCol = c;
      else if (h.includes('терминал')) terminalCol = c;
    }

    // Each method has triplet: [total, current_month, debt]
    // We need column index + 1 (current month value)

    // Aggregate per client
    const clientTotals = new Map<string, { cash: number; transfer: number; qr: number; click: number; terminal: number }>();

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;

      const clientName = norm(row[1]);
      if (!clientName || clientName.length < 2) continue;
      const lower = clientName.toLowerCase();
      if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого') continue;

      const key = normLower(clientName);

      // Get "current month" value (index+1 in each triplet)
      const cash = cashCol >= 0 ? numVal(row[cashCol + 1]) : 0;
      const transfer = transferCol >= 0 ? numVal(row[transferCol + 1]) : 0;
      const qr = qrCol >= 0 ? numVal(row[qrCol + 1]) : 0;
      const click = clickCol >= 0 ? numVal(row[clickCol + 1]) : 0;
      const terminal = terminalCol >= 0 ? numVal(row[terminalCol + 1]) : 0;

      if (cash + transfer + qr + click + terminal <= 0) continue;

      if (!clientTotals.has(key)) {
        clientTotals.set(key, { cash: 0, transfer: 0, qr: 0, click: 0, terminal: 0 });
      }
      const t = clientTotals.get(key)!;
      t.cash += cash;
      t.transfer += transfer;
      t.qr += qr;
      t.click += click;
      t.terminal += terminal;
    }

    // Add to result
    for (const [key, totals] of clientTotals) {
      const total = totals.cash + totals.transfer + totals.qr + totals.click + totals.terminal;
      if (total <= 0) continue;

      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push({ month: m, amounts: { ...totals, total } });
    }
  }

  return result;
}

function fuzzyMatch(key: string, map: Map<string, MonthPayment[]>): MonthPayment[] | undefined {
  // Direct match
  if (map.has(key)) return map.get(key);

  // Fuzzy
  for (const [excelKey, data] of map) {
    if (excelKey.startsWith(key) || key.startsWith(excelKey)) return data;
    if (key.length >= 5 && excelKey.includes(key)) return data;
    if (excelKey.length >= 5 && key.includes(excelKey)) return data;
  }
  return undefined;
}

/**
 * For a client's bad-date payments, determine the best month for each payment.
 *
 * Strategy:
 * 1. If client has only 1 payment in CRM: use month with highest matching total
 * 2. If multiple CRM payments: try to match amounts to specific months, or distribute FIFO
 */
function assignMonths(
  crmPayments: { id: string; amount: number; method: string }[],
  excelMonths: MonthPayment[],
): Map<string, Date> {
  const result = new Map<string, Date>();

  // Sort CRM payments by amount desc
  const sorted = [...crmPayments].sort((a, b) => b.amount - a.amount);

  // Build an array of (month, amount) from Excel, sorted chronologically
  // Each month's total gets expanded into month entries for matching
  const monthAmounts: { month: number; amount: number; used: boolean }[] = [];
  for (const mp of excelMonths) {
    monthAmounts.push({ month: mp.month, amount: mp.amounts.total, used: false });
  }

  // Strategy: try exact amount match first, then closest match, then FIFO
  for (const crm of sorted) {
    let bestIdx = -1;
    let bestDiff = Infinity;

    // Try exact or closest match
    for (let i = 0; i < monthAmounts.length; i++) {
      if (monthAmounts[i].used) continue;
      const diff = Math.abs(monthAmounts[i].amount - crm.amount);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      monthAmounts[bestIdx].used = true;
      const m = monthAmounts[bestIdx].month;
      // Set date to 15th of the month, 2024
      result.set(crm.id, new Date(Date.UTC(2024, m, 15)));
    } else {
      // No more months to match — use the last available month (December)
      const lastMonth = excelMonths.length > 0 ? excelMonths[excelMonths.length - 1].month : 11;
      result.set(crm.id, new Date(Date.UTC(2024, lastMonth, 15)));
    }
  }

  return result;
}

async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  FIX BAD-DATE PAYMENTS (${EXECUTE ? 'EXECUTE' : 'DRY RUN'})`);
  console.log(`${'='.repeat(80)}\n`);

  // 1. Get bad-date payments from DB
  const badPayments = await prisma.$queryRaw<{
    id: string; paid_at: Date; amount: string; method: string;
    deal_id: string; client_id: string; company_name: string;
    deal_created: Date;
  }[]>(Prisma.sql`
    SELECT p.id, p.paid_at, p.amount::text, p.method,
      p.deal_id, p.client_id, c.company_name,
      d.created_at as deal_created
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    JOIN clients c ON c.id = p.client_id
    WHERE p.paid_at < '2020-01-01'
    ORDER BY c.company_name, p.amount DESC
  `);

  console.log(`Bad-date payments: ${badPayments.length}`);

  // 2. Parse 2024 Excel
  console.log('Parsing 2024 Excel...');
  const excel2024 = extractMonthlyTotals();
  console.log(`2024 Excel clients with payments: ${excel2024.size}\n`);

  // 3. Group CRM payments by client
  const byClient = new Map<string, typeof badPayments>();
  for (const p of badPayments) {
    const key = normLower(p.company_name);
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key)!.push(p);
  }

  // 4. Match and assign dates
  let fixedFromExcel = 0;
  let fixedFromDeal = 0;
  let errors = 0;

  const updates: { id: string; newDate: Date; source: string; client: string }[] = [];

  for (const [clientKey, payments] of byClient) {
    const excelMonths = fuzzyMatch(clientKey, excel2024);

    if (excelMonths && excelMonths.length > 0) {
      // Match using Excel data
      const assignments = assignMonths(
        payments.map(p => ({ id: p.id, amount: Number(p.amount), method: p.method })),
        excelMonths,
      );

      for (const [paymentId, newDate] of assignments) {
        updates.push({ id: paymentId, newDate, source: 'excel', client: payments[0].company_name });
        fixedFromExcel++;
      }
    } else {
      // Fallback: use deal.created_at
      for (const p of payments) {
        updates.push({ id: p.id, newDate: p.deal_created, source: 'deal', client: p.company_name });
        fixedFromDeal++;
      }
    }
  }

  // Print summary
  console.log('─'.repeat(100));
  console.log('  SOURCE      |  CLIENT'.padEnd(45) + ' |  PAYMENT ID  |  NEW DATE');
  console.log('─'.repeat(100));

  for (const u of updates.slice(0, 30)) {
    const dateStr = u.newDate.toISOString().split('T')[0];
    console.log(`  ${u.source.padEnd(12)} | ${u.client.substring(0, 35).padEnd(35)} | ${u.id.substring(0, 12)} | ${dateStr}`);
  }
  if (updates.length > 30) {
    console.log(`  ... and ${updates.length - 30} more`);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`  SUMMARY`);
  console.log(`${'='.repeat(80)}`);
  console.log(`  Total bad-date payments: ${badPayments.length}`);
  console.log(`  Fixed from 2024 Excel:   ${fixedFromExcel}`);
  console.log(`  Fixed from deal date:    ${fixedFromDeal}`);
  console.log(`  Total to update:         ${updates.length}`);

  if (EXECUTE) {
    console.log('\n  Executing updates...');
    let done = 0;

    for (const u of updates) {
      try {
        await prisma.payment.update({
          where: { id: u.id },
          data: { paidAt: u.newDate, createdAt: u.newDate },
        });
        done++;
      } catch (e: any) {
        console.error(`  ERROR updating ${u.id}: ${e.message}`);
        errors++;
      }
    }

    console.log(`\n  ✓ Updated: ${done}`);
    if (errors > 0) console.log(`  ✗ Errors: ${errors}`);

    // Verify
    const remaining = await prisma.$queryRaw<{ cnt: string }[]>(
      Prisma.sql`SELECT COUNT(*)::text as cnt FROM payments WHERE paid_at < '2020-01-01'`
    );
    console.log(`\n  Remaining bad-date payments: ${remaining[0].cnt}`);
  } else {
    console.log('\n  This is a DRY RUN. Use --execute to apply changes.');
  }
}

main()
  .catch(err => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
