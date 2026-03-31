import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

const SYNC_MARKS = new Set(['к', 'н/к', 'п/к', 'ф', 'пп']);
const DEBT_MARKS = new Set(['к', 'н/к', 'п/к', 'ф']);

async function main() {
  // 1. Read Excel: compute per-client gross and prepay from closing balances
  const fpath = path.resolve(process.cwd(), '..', '07.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref']!;
  const range = XLSX.utils.decode_range(ref);
  const closingCol = range.e.c + 1 - 2;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  // Collect per-client closing balance and marks
  const clientData = new Map<string, { closing: number; hasDebt: boolean; hasPP: boolean }>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = normalizeClientName(row[1]);
    if (!name) continue;
    const mark = String(row[9] || '').trim().toLowerCase();
    const closing = typeof row[closingCol] === 'number' ? row[closingCol] as number : 0;

    const entry = clientData.get(name) || { closing: 0, hasDebt: false, hasPP: false };
    entry.closing += closing;
    if (DEBT_MARKS.has(mark)) entry.hasDebt = true;
    if (mark === 'пп') entry.hasPP = true;
    clientData.set(name, entry);
  }

  let excelGross = 0;
  let excelPrepay = 0;
  for (const [name, d] of clientData) {
    if (!d.hasDebt && !d.hasPP) continue;
    if (d.closing > 0) excelGross += d.closing;
    else excelPrepay += d.closing;
  }
  console.log(`Excel gross debt: ${excelGross.toLocaleString()}`);
  console.log(`Excel prepayments: ${excelPrepay.toLocaleString()}`);
  console.log(`Excel net: ${(excelGross + excelPrepay).toLocaleString()}`);

  // 2. CRM per-client debt (same logic as debts page)
  const crmRows = await prisma.$queryRaw<{client_id: string, company_name: string, net: string}[]>(Prisma.sql`
    SELECT c.id as client_id, c.company_name,
      COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
    FROM deals d JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
    GROUP BY c.id, c.company_name
    HAVING ABS(SUM(d.amount - d.paid_amount)) > 0.01
  `);

  let crmGross = 0;
  let crmPrepay = 0;
  for (const r of crmRows) {
    const net = Number(r.net);
    if (net > 0) crmGross += net;
    else crmPrepay += net;
  }
  console.log(`\nCRM gross debt: ${crmGross.toLocaleString()}`);
  console.log(`CRM prepayments: ${crmPrepay.toLocaleString()}`);
  console.log(`CRM net: ${(crmGross + crmPrepay).toLocaleString()}`);

  console.log(`\nGross diff: ${(excelGross - crmGross).toLocaleString()}`);
  console.log(`Prepay diff: ${(excelPrepay - crmPrepay).toLocaleString()}`);

  // 3. Per-client comparison
  const crmMap = new Map<string, number>();
  for (const r of crmRows) {
    const norm = normalizeClientName(r.company_name);
    crmMap.set(norm, Number(r.net));
  }

  console.log('\nClients with discrepancy:');
  for (const [name, d] of clientData) {
    if (!d.hasDebt && !d.hasPP) continue;
    const crmDebt = crmMap.get(name) || 0;
    const diff = crmDebt - d.closing;
    if (Math.abs(diff) > 100) {
      console.log(`  ${name.padEnd(30)} | Excel: ${d.closing.toLocaleString().padStart(14)} | CRM: ${crmDebt.toLocaleString().padStart(14)} | diff: ${diff.toLocaleString()}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
