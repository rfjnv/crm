/**
 * Analyze WHY CRM debts page numbers differ from Excel numbers.
 * Compares per-client balances in CRM vs Excel to find exactly where the gap is.
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
  // ── 1. Parse Excel ──
  const fpath = path.resolve(process.cwd(), '..', '07.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref']!;
  const range = XLSX.utils.decode_range(ref);
  const closingCol = range.e.c + 1 - 2;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  // Collect per-client Excel data
  const excelClients = new Map<string, { total: number; hasSyncMark: boolean; hasDebtMark: boolean; hasPPMark: boolean }>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const clientName = normalizeClientName(row[1]);
    if (!clientName) continue;
    const nkpRaw = norm(row[NKP_COL]).toLowerCase();
    const closing = numVal(row[closingCol]);
    const entry = excelClients.get(clientName) || { total: 0, hasSyncMark: false, hasDebtMark: false, hasPPMark: false };
    entry.total += closing;
    if (SYNC_MARKS.has(nkpRaw)) entry.hasSyncMark = true;
    if (DEBT_MARKS.has(nkpRaw)) entry.hasDebtMark = true;
    if (PREPAY_MARKS.has(nkpRaw)) entry.hasPPMark = true;
    excelClients.set(clientName, entry);
  }

  // Only sync clients (with marks)
  const excelSyncClients = new Map<string, number>();
  for (const [name, entry] of excelClients) {
    if (entry.hasSyncMark) {
      excelSyncClients.set(name, entry.total);
    }
  }

  // ── 2. CRM per-client balances (same as debts page) ──
  const crmRows = await prisma.$queryRaw<{ client_id: string; company_name: string; net: string }[]>(
    Prisma.sql`
      SELECT c.id as client_id, c.company_name,
        SUM(d.amount - d.paid_amount)::text as net
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED', 'REJECTED')
      GROUP BY c.id, c.company_name
    `
  );

  // Build CRM map by normalized name
  const crmByName = new Map<string, { id: string; name: string; net: number }>();
  const crmById = new Map<string, { name: string; net: number }>();
  for (const r of crmRows) {
    const net = Number(r.net);
    const normName = normalizeClientName(r.company_name);
    crmByName.set(normName, { id: r.client_id, name: r.company_name, net });
    crmById.set(r.client_id, { name: r.company_name, net });
  }

  // ── 3. Match Excel to CRM ──
  const matchedExcel = new Set<string>();
  const matchedCrm = new Set<string>();
  const matches: { excelName: string; crmName: string; crmId: string; excelBal: number; crmNet: number }[] = [];

  // Exact match
  for (const [excelName, excelBal] of excelSyncClients) {
    if (crmByName.has(excelName)) {
      const crm = crmByName.get(excelName)!;
      matches.push({ excelName, crmName: crm.name, crmId: crm.id, excelBal, crmNet: crm.net });
      matchedExcel.add(excelName);
      matchedCrm.add(crm.id);
    }
  }

  // Prefix match for remaining
  for (const [excelName, excelBal] of excelSyncClients) {
    if (matchedExcel.has(excelName)) continue;
    for (const [crmNorm, crm] of crmByName) {
      if (matchedCrm.has(crm.id)) continue;
      if (crmNorm.startsWith(excelName) || excelName.startsWith(crmNorm)) {
        matches.push({ excelName, crmName: crm.name, crmId: crm.id, excelBal, crmNet: crm.net });
        matchedExcel.add(excelName);
        matchedCrm.add(crm.id);
        break;
      }
    }
  }

  // ── 4. Analysis ──
  console.log('=== РАЗНИЦА CRM vs EXCEL: ДЕТАЛЬНЫЙ АНАЛИЗ ===\n');

  // A. Matched clients where CRM != Excel
  console.log('--- A. Несовпадение у совпавших клиентов ---');
  let matchedDiffGross = 0;
  let matchedDiffPrepay = 0;
  const diffs = matches.filter(m => Math.abs(m.crmNet - m.excelBal) >= 1);
  for (const m of diffs.sort((a, b) => Math.abs(b.crmNet - b.excelBal) - Math.abs(a.crmNet - a.excelBal))) {
    const diff = m.crmNet - m.excelBal;
    console.log(`  ${m.crmName}: CRM=${fmtNum(m.crmNet)}, Excel=${fmtNum(m.excelBal)}, разница=${fmtNum(diff)}`);
    if (diff > 0) matchedDiffGross += diff;
    else matchedDiffPrepay += diff;
  }
  console.log(`  Итого разница: gross +${fmtNum(matchedDiffGross)}, prepay ${fmtNum(matchedDiffPrepay)}`);

  // B. CRM-only clients (not in Excel)
  console.log('\n--- B. Клиенты только в CRM (нет в Excel) ---');
  let crmOnlyGross = 0;
  let crmOnlyPrepay = 0;
  const crmOnlyClients: { name: string; net: number }[] = [];
  for (const [crmId, crm] of crmById) {
    if (!matchedCrm.has(crmId)) {
      crmOnlyClients.push({ name: crm.name, net: crm.net });
      if (crm.net > 0) crmOnlyGross += crm.net;
      else crmOnlyPrepay += crm.net;
    }
  }
  crmOnlyClients.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  for (const c of crmOnlyClients) {
    console.log(`  ${c.name}: ${fmtNum(c.net)}`);
  }
  console.log(`  Итого CRM-only: gross +${fmtNum(crmOnlyGross)}, prepay ${fmtNum(crmOnlyPrepay)}, net ${fmtNum(crmOnlyGross + crmOnlyPrepay)}`);

  // C. Excel-only clients (not in CRM or no deals)
  console.log('\n--- C. Клиенты только в Excel (нет в CRM) ---');
  let excelOnlyTotal = 0;
  for (const [excelName, excelBal] of excelSyncClients) {
    if (!matchedExcel.has(excelName)) {
      console.log(`  ${excelName}: Excel=${fmtNum(excelBal)}`);
      excelOnlyTotal += excelBal;
    }
  }
  console.log(`  Итого Excel-only: ${fmtNum(excelOnlyTotal)}`);

  // D. Overall summary
  console.log('\n=== ИТОГО: КАК ФОРМИРУЕТСЯ РАЗНИЦА ===');

  // CRM debts page totals
  let crmGross = 0, crmPrepay = 0;
  for (const [, crm] of crmById) {
    if (crm.net > 0) crmGross += crm.net;
    else crmPrepay += crm.net;
  }

  // Excel totals
  let excelDebt = 0, excelPP = 0;
  for (const [name, entry] of excelClients) {
    if (!entry.hasSyncMark) continue;
    if (entry.total > 0) excelDebt += entry.total;
    else excelPP += entry.total;
  }

  console.log(`\n  CRM Валовой долг:     ${fmtNum(crmGross)}`);
  console.log(`  Excel долг (>0):      ${fmtNum(excelDebt)}`);
  console.log(`  Разница gross:        ${fmtNum(crmGross - excelDebt)}`);
  console.log(`    из них от CRM-only: ${fmtNum(crmOnlyGross)}`);
  console.log(`    из них от matched:  ${fmtNum(matchedDiffGross)}`);
  console.log(`    из них от Excel-only: -${fmtNum(excelOnlyTotal > 0 ? excelOnlyTotal : 0)}`);

  console.log(`\n  CRM Предоплаты:       ${fmtNum(crmPrepay)}`);
  console.log(`  Excel пп (<0):        ${fmtNum(excelPP)}`);
  console.log(`  Разница prepay:       ${fmtNum(crmPrepay - excelPP)}`);
  console.log(`    из них от CRM-only: ${fmtNum(crmOnlyPrepay)}`);
  console.log(`    из них от matched:  ${fmtNum(matchedDiffPrepay)}`);

  console.log(`\n  CRM Чистый долг:      ${fmtNum(crmGross + crmPrepay)}`);
  console.log(`  Excel Чистый:         ${fmtNum(excelDebt + excelPP)}`);
  console.log(`  Разница net:          ${fmtNum((crmGross + crmPrepay) - (excelDebt + excelPP))}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
