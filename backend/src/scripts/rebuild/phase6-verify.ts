/**
 * Phase 6: Verify — compare CRM per-client debt vs Excel closing balances.
 *
 * Run:  cd backend && npx tsx src/scripts/rebuild/phase6-verify.ts
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../../lib/normalize-client';

const prisma = new PrismaClient();

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
const DEBT_MARKS = new Set(['к', 'н/к', 'п/к', 'ф']);
const PREPAY_MARKS = new Set(['пп']);
const SYNC_MARKS = new Set([...DEBT_MARKS, ...PREPAY_MARKS]);
const NKP_COL = 9;

type Row = unknown[];

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function norm(s: unknown): string {
  return s == null ? '' : String(s).trim().replace(/\s+/g, ' ');
}

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

async function main() {
  console.log('=== Phase 6: VERIFICATION ===\n');

  // 1. Parse Excel closing balances
  const fpath = path.resolve(process.cwd(), '..', '10.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref'];
  const range = ref ? XLSX.utils.decode_range(ref) : null;
  const closingCol = range ? range.e.c + 1 - 2 : 26;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

  const excelClients = new Map<string, { total: number; hasSyncMark: boolean }>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i] as Row;
    if (!row) continue;
    const clientName = normalizeClientName(row[1]);
    if (!clientName) continue;
    const nkp = norm(row[NKP_COL]).toLowerCase();
    const closing = numVal(row[closingCol]);
    const entry = excelClients.get(clientName) || { total: 0, hasSyncMark: false };
    entry.total += closing;
    if (SYNC_MARKS.has(nkp)) entry.hasSyncMark = true;
    excelClients.set(clientName, entry);
  }

  // Excel totals
  let excelGrossDebt = 0;
  let excelPrepayments = 0;
  for (const [, entry] of excelClients) {
    if (!entry.hasSyncMark) continue;
    if (entry.total > 0) excelGrossDebt += entry.total;
    else excelPrepayments += Math.abs(entry.total);
  }
  const excelNet = excelGrossDebt - excelPrepayments;

  // 2. CRM totals
  const crmResult = await prisma.$queryRaw<{ gross: string; prepay: string }[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
      COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as prepay
    FROM deals d
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
  `);
  const crmGross = Number(crmResult[0].gross);
  const crmPrepay = Number(crmResult[0].prepay);
  const crmNet = crmGross - crmPrepay;

  // 3. Per-client comparison
  const crmClientDebts = await prisma.$queryRaw<{ client_id: string; company_name: string; net: string }[]>(Prisma.sql`
    SELECT d.client_id, c.company_name, COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
    FROM deals d JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
    GROUP BY d.client_id, c.company_name
  `);

  const crmNorm = new Map<string, { clientId: string; name: string; net: number }>();
  for (const r of crmClientDebts) {
    crmNorm.set(normalizeClientName(r.company_name), { clientId: r.client_id, name: r.company_name, net: Number(r.net) });
  }

  // Match and compare
  let matchedCount = 0;
  let withinTolerance = 0;
  let outsideTolerance = 0;
  const mismatches: { name: string; crmDebt: number; excelClosing: number; diff: number }[] = [];

  for (const [excelKey, entry] of excelClients) {
    if (!entry.hasSyncMark) continue;
    const crm = crmNorm.get(excelKey);
    if (!crm) continue;

    matchedCount++;
    const diff = crm.net - entry.total;

    if (Math.abs(diff) <= 1000) {
      withinTolerance++;
    } else {
      outsideTolerance++;
      mismatches.push({ name: crm.name, crmDebt: crm.net, excelClosing: entry.total, diff });
    }
  }

  // Output
  console.log('='.repeat(80));
  console.log('  GLOBAL TOTALS COMPARISON');
  console.log('='.repeat(80));
  console.log(`                   CRM              Excel           Diff`);
  console.log(`  Gross debt:      ${fmtNum(crmGross).padStart(16)} ${fmtNum(excelGrossDebt).padStart(16)} ${fmtNum(crmGross - excelGrossDebt).padStart(16)}`);
  console.log(`  Prepayments:     ${fmtNum(crmPrepay).padStart(16)} ${fmtNum(excelPrepayments).padStart(16)} ${fmtNum(crmPrepay - excelPrepayments).padStart(16)}`);
  console.log(`  Net debt:        ${fmtNum(crmNet).padStart(16)} ${fmtNum(excelNet).padStart(16)} ${fmtNum(crmNet - excelNet).padStart(16)}`);

  const globalOk = Math.abs(crmNet - excelNet) < 100_000;
  console.log(`\n  Status: ${globalOk ? 'PASS' : 'FAIL'} (tolerance: ±100,000)`);

  console.log('\n' + '='.repeat(80));
  console.log('  PER-CLIENT COMPARISON');
  console.log('='.repeat(80));
  console.log(`  Matched clients:          ${matchedCount}`);
  console.log(`  Within tolerance (±1000): ${withinTolerance}`);
  console.log(`  Outside tolerance:        ${outsideTolerance}`);

  if (mismatches.length > 0) {
    mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    console.log(`\n  Top mismatches:`);
    console.log(`  ${'Client'.padEnd(30)} ${'CRM'.padStart(16)} ${'Excel'.padStart(16)} ${'Diff'.padStart(16)}`);
    console.log(`  ${'-'.repeat(78)}`);
    for (const m of mismatches.slice(0, 20)) {
      console.log(`  ${m.name.substring(0, 30).padEnd(30)} ${fmtNum(m.crmDebt).padStart(16)} ${fmtNum(m.excelClosing).padStart(16)} ${fmtNum(m.diff).padStart(16)}`);
    }
  }

  // Overall verdict
  const clientOk = outsideTolerance === 0;
  console.log('\n' + '='.repeat(80));
  console.log(`  VERDICT: ${globalOk && clientOk ? 'ALL PASS — safe to remove Excel override' : 'NEEDS ATTENTION'}`);
  console.log('='.repeat(80));
}

main().catch(console.error).finally(() => prisma.$disconnect());
