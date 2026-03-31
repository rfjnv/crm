/**
 * Analyze bad-date payments and match with 2024 Excel data.
 *
 * Run: cd backend && npx tsx src/scripts/_analyze-bad-payments.ts
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const FILE_2024 = path.resolve(__dirname, '../../../26.12.2024.xlsx');

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

interface SheetLayout {
  clientCol: number;
  openBalCol: number;
  closeBalCol: number;
  // Payment method columns: [total, current_month, debt] triplets
  cashCols: number[];    // накд
  transferCols: number[]; // пер
  qrCols: number[];       // QR CODE
  clickCols: number[];    // пластик/клик
  terminalCols: number[]; // терминал
}

function detectLayout(ws: XLSX.WorkSheet): SheetLayout | null {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (rows.length < 3) return null;

  const row0 = (rows[0] || []).map((v: any) => normLower(norm(v)));
  const row1 = (rows[1] || []).map((v: any) => normLower(norm(v)));

  const range = XLSX.utils.decode_range(ws['!ref']!);
  const totalCols = range.e.c + 1;

  // Client is always col 1
  const clientCol = 1;

  // Opening balance: look for "остаток" or "ост" in row 0/1
  let openBalCol = 2;

  // Closing balance: 2nd-to-last or 3rd-to-last before "число"
  let closeBalCol = totalCols - 2;
  // Check if last col is "число"
  const lastHeader = row0[totalCols - 1] || '';
  if (lastHeader.includes('число') || lastHeader === '') {
    closeBalCol = totalCols - 2;
  }
  // Verify it says "остаток" or "ост"
  for (let c = totalCols - 3; c < totalCols; c++) {
    const h = row0[c] || row1[c] || '';
    if (h.includes('ост')) {
      closeBalCol = c;
      // If there's also a "сум" column next to it, take the сум one
      const next = row1[c] || '';
      const nextNext = row1[c+1] || '';
      if (nextNext.includes('сум') || nextNext.includes('остаток')) {
        closeBalCol = c + 1;
      }
      break;
    }
  }

  // Find payment method columns by scanning row 1 headers
  const cashCols: number[] = [];
  const transferCols: number[] = [];
  const qrCols: number[] = [];
  const clickCols: number[] = [];
  const terminalCols: number[] = [];

  for (let c = 0; c < totalCols; c++) {
    const h0 = row0[c] || '';
    const h1 = row1[c] || '';

    if (h1.includes('накд') || h0.includes('накд')) {
      // Cash: "накд" then [total, month, debt]
      cashCols.push(c, c + 1, c + 2);
    } else if ((h1.includes('пер') && !h1.includes('перечисл')) || h0.includes('пер')) {
      transferCols.push(c, c + 1, c + 2);
    } else if (h1.includes('qr') || h0.includes('qr')) {
      qrCols.push(c, c + 1, c + 2);
    } else if (h1.includes('пластик') || h1.includes('клик') || h0.includes('пластик') || h0.includes('клик')) {
      clickCols.push(c, c + 1, c + 2);
    } else if (h1.includes('терминал') || h0.includes('терминал')) {
      terminalCols.push(c, c + 1, c + 2);
    }
  }

  return { clientCol, openBalCol, closeBalCol, cashCols, transferCols, qrCols, clickCols, terminalCols };
}

interface ClientMonthPayment {
  month: number; // 0-11
  monthName: string;
  cash: number;
  transfer: number;
  qr: number;
  click: number;
  terminal: number;
  total: number;
}

function extractPayments2024(): Map<string, ClientMonthPayment[]> {
  const wb = XLSX.readFile(FILE_2024);
  const result = new Map<string, ClientMonthPayment[]>();

  for (let m = 0; m < Math.min(wb.SheetNames.length, 12); m++) {
    const ws = wb.Sheets[wb.SheetNames[m]];
    if (!ws || !ws['!ref']) continue;

    const layout = detectLayout(ws);
    if (!layout) continue;

    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;

      const clientName = norm(row[layout.clientCol]);
      if (!clientName || clientName.length < 2) continue;
      const lower = clientName.toLowerCase();
      if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого') continue;

      // Get per-method "current month" payment (column index 1 in each triplet)
      const cash = layout.cashCols.length >= 2 ? numVal(row[layout.cashCols[1]]) : 0;
      const transfer = layout.transferCols.length >= 2 ? numVal(row[layout.transferCols[1]]) : 0;
      const qr = layout.qrCols.length >= 2 ? numVal(row[layout.qrCols[1]]) : 0;
      const click = layout.clickCols.length >= 2 ? numVal(row[layout.clickCols[1]]) : 0;
      const terminal = layout.terminalCols.length >= 2 ? numVal(row[layout.terminalCols[1]]) : 0;
      const total = cash + transfer + qr + click + terminal;

      if (total <= 0) continue;

      const key = normLower(clientName);
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push({
        month: m,
        monthName: MONTH_NAMES[m],
        cash, transfer, qr, click, terminal, total,
      });
    }
  }

  return result;
}

async function main() {
  console.log('='.repeat(80));
  console.log('  BAD-DATE PAYMENTS ANALYSIS');
  console.log('='.repeat(80));

  // 1. Get all bad-date payments from DB
  const badPayments = await prisma.$queryRaw<{
    id: string; paid_at: Date; amount: string; method: string;
    deal_id: string; client_id: string; company_name: string;
    deal_title: string; deal_created: Date; note: string | null;
  }[]>(Prisma.sql`
    SELECT p.id, p.paid_at, p.amount::text, p.method,
      p.deal_id, p.client_id, c.company_name,
      d.title as deal_title, d.created_at as deal_created, p.note
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    JOIN clients c ON c.id = p.client_id
    WHERE p.paid_at < '2020-01-01'
    ORDER BY c.company_name, p.amount DESC
  `);

  console.log(`\nBad-date payments: ${badPayments.length}`);

  // Group by client
  const byClient = new Map<string, typeof badPayments>();
  for (const p of badPayments) {
    const key = normLower(p.company_name);
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key)!.push(p);
  }
  console.log(`Unique clients with bad dates: ${byClient.size}`);

  // 2. Extract 2024 payments from Excel
  console.log('\nParsing 2024 Excel...');
  const excel2024 = extractPayments2024();
  console.log(`Clients with payments in 2024 Excel: ${excel2024.size}`);

  // 3. Match
  let matched = 0;
  let unmatched = 0;
  const unmatchedClients: string[] = [];

  console.log('\n' + '='.repeat(120));
  console.log('  CLIENT MATCHING RESULTS');
  console.log('='.repeat(120));

  for (const [clientKey, payments] of byClient) {
    // Try to find in Excel
    let excelPayments = excel2024.get(clientKey);

    // Fuzzy match if not found
    if (!excelPayments) {
      for (const [excelKey, excelData] of excel2024) {
        if (excelKey.startsWith(clientKey) || clientKey.startsWith(excelKey)) {
          excelPayments = excelData;
          break;
        }
        if (clientKey.length >= 5 && excelKey.includes(clientKey)) { excelPayments = excelData; break; }
        if (excelKey.length >= 5 && clientKey.includes(excelKey)) { excelPayments = excelData; break; }
      }
    }

    const crmTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
    const excelTotal = excelPayments ? excelPayments.reduce((s, p) => s + p.total, 0) : 0;

    if (excelPayments) {
      matched += payments.length;
      const months = excelPayments.map(p => p.monthName).join(', ');
      console.log(`✓ ${payments[0].company_name.substring(0, 35).padEnd(35)} | CRM: ${payments.length} payments ${crmTotal.toLocaleString().padStart(15)} | Excel months: ${months}`);
    } else {
      unmatched += payments.length;
      unmatchedClients.push(payments[0].company_name);
      console.log(`✗ ${payments[0].company_name.substring(0, 35).padEnd(35)} | CRM: ${payments.length} payments ${crmTotal.toLocaleString().padStart(15)} | NOT IN EXCEL 2024`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`  SUMMARY`);
  console.log('='.repeat(80));
  console.log(`  Total bad-date payments: ${badPayments.length}`);
  console.log(`  Matched to 2024 Excel: ${matched}`);
  console.log(`  Unmatched: ${unmatched}`);
  if (unmatchedClients.length > 0) {
    console.log(`\n  Unmatched clients:`);
    for (const c of unmatchedClients) console.log(`    - ${c}`);
  }
}

main()
  .catch(err => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
