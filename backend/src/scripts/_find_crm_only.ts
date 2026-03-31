/**
 * Find ALL CRM-only clients (not in Excel sync list) that have non-zero balance.
 * These are the remaining sources of difference.
 */
import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}
function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

const DEBT_MARKS = new Set(['к', 'н/к', 'п/к', 'ф']);
const PREPAY_MARKS = new Set(['пп']);
const SYNC_MARKS = new Set([...DEBT_MARKS, ...PREPAY_MARKS]);
const NKP_COL = 9;

async function main() {
  // Parse Excel sync clients
  const fpath = path.resolve(process.cwd(), '..', '07.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref']!;
  const range = XLSX.utils.decode_range(ref);
  const closingCol = range.e.c + 1 - 2;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  const excelClients = new Map<string, { total: number; hasSyncMark: boolean }>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const clientName = normalizeClientName(row[1]);
    if (!clientName) continue;
    const nkpRaw = norm(row[NKP_COL]).toLowerCase();
    const closing = numVal(row[closingCol]);
    const entry = excelClients.get(clientName) || { total: 0, hasSyncMark: false };
    entry.total += closing;
    if (SYNC_MARKS.has(nkpRaw)) entry.hasSyncMark = true;
    excelClients.set(clientName, entry);
  }

  // Get all Excel names (even non-sync) to identify truly CRM-only
  const allExcelNames = new Set(excelClients.keys());

  // CRM per-client balances
  const crmRows = await prisma.$queryRaw<{ client_id: string; company_name: string; net: string }[]>(
    Prisma.sql`
      SELECT c.id as client_id, c.company_name,
        SUM(d.amount - d.paid_amount)::text as net
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
      GROUP BY c.id, c.company_name
      HAVING ABS(SUM(d.amount - d.paid_amount)) > 0.01
    `
  );

  // Match CRM to Excel
  const matchedCrmIds = new Set<string>();
  for (const r of crmRows) {
    const normName = normalizeClientName(r.company_name);
    if (allExcelNames.has(normName)) {
      matchedCrmIds.add(r.client_id);
      continue;
    }
    // prefix match
    for (const exName of allExcelNames) {
      if (normName.startsWith(exName) || exName.startsWith(normName)) {
        matchedCrmIds.add(r.client_id);
        break;
      }
    }
  }

  // CRM-only with non-zero balance
  console.log('=== CRM-ONLY CLIENTS WITH NON-ZERO BALANCE ===\n');
  let totalPos = 0, totalNeg = 0;
  const crmOnly: { name: string; net: number }[] = [];

  for (const r of crmRows) {
    if (matchedCrmIds.has(r.client_id)) continue;
    const net = Number(r.net);
    crmOnly.push({ name: r.company_name, net });
    if (net > 0) totalPos += net;
    else totalNeg += net;
  }

  crmOnly.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  for (const c of crmOnly) {
    console.log(`  ${c.name}: ${fmtNum(c.net)}`);
  }

  console.log(`\n  Total CRM-only positive (adds to gross): ${fmtNum(totalPos)}`);
  console.log(`  Total CRM-only negative (adds to prepay): ${fmtNum(totalNeg)}`);
  console.log(`  Total CRM-only count: ${crmOnly.length}`);

  // What the debts page WOULD show with only Excel-matched clients:
  let excelMatchedGross = 0, excelMatchedPrepay = 0;
  for (const r of crmRows) {
    if (!matchedCrmIds.has(r.client_id)) continue;
    const net = Number(r.net);
    if (net > 0) excelMatchedGross += net;
    else excelMatchedPrepay += net;
  }

  console.log(`\n=== IF DEBTS PAGE ONLY SHOWED EXCEL-MATCHED CLIENTS ===`);
  console.log(`  Gross:    ${fmtNum(excelMatchedGross)}`);
  console.log(`  Prepay:   ${fmtNum(excelMatchedPrepay)}`);
  console.log(`  Net:      ${fmtNum(excelMatchedGross + excelMatchedPrepay)}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
