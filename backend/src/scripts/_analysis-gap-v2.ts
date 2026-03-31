/**
 * CORRECTED gap analysis: CRM (1,318M) vs Excel (1,013M) — 305M gap.
 * FIX: Excel has multiple rows per client — SUM closing balances per client.
 * READ-ONLY — no INSERT/UPDATE/DELETE.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/** Parse Feb 2026 sheet — SUM closing per client (multiple rows per client) */
function parseFeb2026(): { total: number; clients: Map<string, number> } {
  const fname = '28.02.2026.xlsx';
  const fpath = path.resolve(process.cwd(), '..', fname);
  const clients = new Map<string, number>();
  let total = 0;

  if (!fs.existsSync(fpath)) return { total, clients };
  const wb = XLSX.readFile(fpath);
  const lastSheet = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[lastSheet];
  const ref = ws['!ref']!;
  const range = XLSX.utils.decode_range(ref);
  const closingCol = range.e.c + 1 - 2;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  let rowCount = 0;
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = String(row[1] || '').trim().toLowerCase();
    if (!name) continue;
    const closing = numVal(row[closingCol]);
    // SUM per client, not overwrite
    clients.set(name, (clients.get(name) || 0) + closing);
    total += closing;
    rowCount++;
  }

  console.log(`Excel Feb 2026 "${lastSheet}": ${rowCount} rows, ${clients.size} unique clients, total: ${total.toLocaleString('ru-RU')}`);
  return { total, clients };
}

async function main() {
  console.log('=== CORRECTED GAP ANALYSIS: CRM (1.318B) vs Excel (1.013B) ===\n');

  const feb = parseFeb2026();

  // CRM debt per client
  const crmClients = await prisma.$queryRaw<{
    client_id: string;
    company_name: string;
    crm_gross: string;
    deal_count: string;
    oldest_deal: string;
    newest_deal: string;
  }[]>(
    Prisma.sql`
    SELECT c.id AS client_id, c.company_name,
           COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text AS crm_gross,
           COUNT(d.id)::text AS deal_count,
           MIN(d.created_at)::date::text AS oldest_deal,
           MAX(d.created_at)::date::text AS newest_deal
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY c.id, c.company_name
    ORDER BY COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0) DESC`
  );

  // Build comparison — ALL clients (not just CRM debt > 0)
  interface CompRow {
    client_id: string;
    company_name: string;
    crm_gross: number;
    excel_closing: number;
    diff: number;
    deal_count: number;
    oldest_deal: string;
    newest_deal: string;
    in_excel: boolean;
    category: string;
  }

  const rows: CompRow[] = [];
  const crmNames = new Set<string>();

  for (const c of crmClients) {
    const name = c.company_name.trim().toLowerCase();
    crmNames.add(name);
    const crmGross = Number(c.crm_gross);
    const excelClosing = feb.clients.get(name) ?? 0;
    const inExcel = feb.clients.has(name);
    const diff = crmGross - excelClosing;

    let category = '';
    if (crmGross <= 0 && excelClosing <= 0) continue; // both zero, skip
    if (crmGross > 0 && !inExcel) {
      category = 'CRM_ONLY';
    } else if (crmGross <= 0 && excelClosing > 0) {
      category = 'EXCEL_ONLY_DEBT';
    } else if (Math.abs(diff) < 100) {
      category = 'MATCH';
    } else if (diff > 0) {
      category = 'CRM_HIGHER';
    } else {
      category = 'EXCEL_HIGHER';
    }

    rows.push({
      client_id: c.client_id,
      company_name: c.company_name.trim(),
      crm_gross: crmGross,
      excel_closing: excelClosing,
      diff,
      deal_count: Number(c.deal_count),
      oldest_deal: c.oldest_deal,
      newest_deal: c.newest_deal,
      in_excel: inExcel,
      category,
    });
  }

  // Excel-only clients (not in CRM at all)
  for (const [name, closing] of feb.clients) {
    if (closing <= 0) continue;
    if (crmNames.has(name)) continue;
    rows.push({
      client_id: '',
      company_name: name,
      crm_gross: 0,
      excel_closing: closing,
      diff: -closing,
      deal_count: 0,
      oldest_deal: '',
      newest_deal: '',
      in_excel: true,
      category: 'EXCEL_ONLY_NOCRL',
    });
  }

  // Summary by category
  const categories = new Map<string, { count: number; crmSum: number; excelSum: number; diffSum: number }>();
  for (const r of rows) {
    const cat = categories.get(r.category) || { count: 0, crmSum: 0, excelSum: 0, diffSum: 0 };
    cat.count++;
    cat.crmSum += r.crm_gross;
    cat.excelSum += r.excel_closing;
    cat.diffSum += r.diff;
    categories.set(r.category, cat);
  }

  console.log('=== BREAKDOWN BY CATEGORY ===');
  console.log(`${'Category'.padEnd(18)} ${'Count'.padStart(6)} ${'CRM Debt'.padStart(18)} ${'Excel'.padStart(18)} ${'Diff'.padStart(18)}`);
  console.log('-'.repeat(82));
  let totalDiff = 0;
  let totalCrm = 0;
  let totalExcel = 0;
  for (const [cat, data] of [...categories].sort((a, b) => b[1].diffSum - a[1].diffSum)) {
    console.log(`${cat.padEnd(18)} ${String(data.count).padStart(6)} ${data.crmSum.toLocaleString('ru-RU').padStart(18)} ${data.excelSum.toLocaleString('ru-RU').padStart(18)} ${data.diffSum.toLocaleString('ru-RU').padStart(18)}`);
    totalDiff += data.diffSum;
    totalCrm += data.crmSum;
    totalExcel += data.excelSum;
  }
  console.log('-'.repeat(82));
  console.log(`${'TOTAL'.padEnd(18)} ${String(rows.length).padStart(6)} ${totalCrm.toLocaleString('ru-RU').padStart(18)} ${totalExcel.toLocaleString('ru-RU').padStart(18)} ${totalDiff.toLocaleString('ru-RU').padStart(18)}`);

  // CRM_ONLY clients
  const crmOnly = rows.filter(r => r.category === 'CRM_ONLY').sort((a, b) => b.crm_gross - a.crm_gross);
  if (crmOnly.length > 0) {
    console.log(`\n=== CRM-ONLY CLIENTS (not in Excel Feb 2026): ${crmOnly.length} clients ===`);
    console.log(`${'Client'.padEnd(35)} ${'CRM Debt'.padStart(15)} ${'Deals'.padStart(6)} ${'Oldest'.padStart(12)}`);
    for (const r of crmOnly.slice(0, 20)) {
      console.log(`${r.company_name.padEnd(35)} ${r.crm_gross.toLocaleString('ru-RU').padStart(15)} ${String(r.deal_count).padStart(6)} ${r.oldest_deal.padStart(12)}`);
    }
  }

  // CRM_HIGHER clients
  const crmHigher = rows.filter(r => r.category === 'CRM_HIGHER').sort((a, b) => b.diff - a.diff);
  console.log(`\n=== CRM > EXCEL: ${crmHigher.length} clients, total diff: ${crmHigher.reduce((s, r) => s + r.diff, 0).toLocaleString('ru-RU')} ===`);
  console.log(`${'Client'.padEnd(35)} ${'CRM'.padStart(15)} ${'Excel'.padStart(15)} ${'Diff'.padStart(15)}`);
  for (const r of crmHigher.slice(0, 20)) {
    console.log(`${r.company_name.padEnd(35)} ${r.crm_gross.toLocaleString('ru-RU').padStart(15)} ${r.excel_closing.toLocaleString('ru-RU').padStart(15)} ${r.diff.toLocaleString('ru-RU').padStart(15)}`);
  }

  // EXCEL_HIGHER clients
  const excelHigher = rows.filter(r => r.category === 'EXCEL_HIGHER').sort((a, b) => a.diff - b.diff);
  console.log(`\n=== EXCEL > CRM: ${excelHigher.length} clients, total diff: ${excelHigher.reduce((s, r) => s + r.diff, 0).toLocaleString('ru-RU')} ===`);
  console.log(`${'Client'.padEnd(35)} ${'CRM'.padStart(15)} ${'Excel'.padStart(15)} ${'Diff'.padStart(15)}`);
  for (const r of excelHigher.slice(0, 20)) {
    console.log(`${r.company_name.padEnd(35)} ${r.crm_gross.toLocaleString('ru-RU').padStart(15)} ${r.excel_closing.toLocaleString('ru-RU').padStart(15)} ${r.diff.toLocaleString('ru-RU').padStart(15)}`);
  }

  // EXCEL_ONLY_DEBT (CRM=0 but Excel>0)
  const excelOnlyDebt = rows.filter(r => r.category === 'EXCEL_ONLY_DEBT').sort((a, b) => b.excel_closing - a.excel_closing);
  console.log(`\n=== EXCEL DEBT BUT CRM = 0: ${excelOnlyDebt.length} clients, total Excel: ${excelOnlyDebt.reduce((s, r) => s + r.excel_closing, 0).toLocaleString('ru-RU')} ===`);
  console.log(`${'Client'.padEnd(35)} ${'Excel Closing'.padStart(15)} ${'Deals'.padStart(6)}`);
  for (const r of excelOnlyDebt.slice(0, 20)) {
    console.log(`${r.company_name.padEnd(35)} ${r.excel_closing.toLocaleString('ru-RU').padStart(15)} ${String(r.deal_count).padStart(6)}`);
  }

  // EXCEL_ONLY_NOCRL
  const excelNoCrm = rows.filter(r => r.category === 'EXCEL_ONLY_NOCRL').sort((a, b) => b.excel_closing - a.excel_closing);
  if (excelNoCrm.length > 0) {
    console.log(`\n=== EXCEL-ONLY (not in CRM): ${excelNoCrm.length} clients, total: ${excelNoCrm.reduce((s, r) => s + r.excel_closing, 0).toLocaleString('ru-RU')} ===`);
    for (const r of excelNoCrm) {
      console.log(`  ${r.company_name.padEnd(35)} ${r.excel_closing.toLocaleString('ru-RU').padStart(15)}`);
    }
  }

  // MATCH
  const matched = rows.filter(r => r.category === 'MATCH');
  console.log(`\n=== MATCHED (diff < 100): ${matched.length} clients ===`);

  // Drill into top 5 CRM_HIGHER
  console.log('\n=== DRILL DOWN: TOP 5 CRM > EXCEL ===');
  for (const r of crmHigher.slice(0, 5)) {
    const deals = await prisma.$queryRaw<{
      id: string;
      title: string;
      amount: string;
      paid_amount: string;
      debt: string;
      created_at: string;
      item_count: string;
    }[]>(
      Prisma.sql`
      SELECT d.id, d.title, d.amount::text, d.paid_amount::text,
             GREATEST(d.amount - d.paid_amount, 0)::text AS debt,
             d.created_at::date::text,
             (SELECT COUNT(*) FROM deal_items di WHERE di.deal_id = d.id)::text AS item_count
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE c.company_name = ${r.company_name}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.amount > d.paid_amount + 1
      ORDER BY GREATEST(d.amount - d.paid_amount, 0) DESC`
    );

    console.log(`\n  ${r.company_name}: CRM=${r.crm_gross.toLocaleString('ru-RU')}, Excel=${r.excel_closing.toLocaleString('ru-RU')}, diff=${r.diff.toLocaleString('ru-RU')}`);
    console.log(`  ${'Title'.padEnd(40)} ${'Amount'.padStart(12)} ${'Paid'.padStart(12)} ${'Debt'.padStart(12)} ${'Date'.padStart(12)} ${'Items'.padStart(6)}`);
    for (const d of deals.slice(0, 5)) {
      console.log(`  ${(d.title || '(no title)').substring(0, 40).padEnd(40)} ${Number(d.amount).toLocaleString('ru-RU').padStart(12)} ${Number(d.paid_amount).toLocaleString('ru-RU').padStart(12)} ${Number(d.debt).toLocaleString('ru-RU').padStart(12)} ${d.created_at.padStart(12)} ${d.item_count.padStart(6)}`);
    }
  }

  // FINAL SUMMARY
  console.log('\n=== FINAL GAP DECOMPOSITION ===');
  console.log(`CRM total gross debt:          ${totalCrm.toLocaleString('ru-RU')}`);
  console.log(`Excel total closing (Feb 2026): ${feb.total.toLocaleString('ru-RU')}`);
  console.log(`Excel matched to CRM clients:  ${totalExcel.toLocaleString('ru-RU')}`);
  console.log(`Gap (CRM - Excel total):        ${(totalCrm - feb.total).toLocaleString('ru-RU')}`);
  console.log();

  const crmOnlySum = crmOnly.reduce((s, r) => s + r.crm_gross, 0);
  const crmHigherSum = crmHigher.reduce((s, r) => s + r.diff, 0);
  const excelHigherSum = excelHigher.reduce((s, r) => s + r.diff, 0);
  const excelOnlyDebtSum = excelOnlyDebt.reduce((s, r) => s + r.excel_closing, 0);
  const excelNoCrmSum = excelNoCrm.reduce((s, r) => s + r.excel_closing, 0);
  // Unmatched excel: total excel minus matched
  const unmatchedExcel = feb.total - totalExcel;

  console.log(`Decomposition:`);
  console.log(`  A. CRM-only clients (no Excel):     +${crmOnlySum.toLocaleString('ru-RU')} (${crmOnly.length} clients)`);
  console.log(`  B. CRM > Excel (matched):           +${crmHigherSum.toLocaleString('ru-RU')} (${crmHigher.length} clients)`);
  console.log(`  C. Excel > CRM (matched):           ${excelHigherSum.toLocaleString('ru-RU')} (${excelHigher.length} clients)`);
  console.log(`  D. Excel debt, CRM=0 (in CRM):      -${excelOnlyDebtSum.toLocaleString('ru-RU')} (${excelOnlyDebt.length} clients)`);
  console.log(`  E. Excel-only (not in CRM):          -${excelNoCrmSum.toLocaleString('ru-RU')} (${excelNoCrm.length} clients)`);
  console.log(`  F. Unmatched Excel (name mismatch):  -${unmatchedExcel.toLocaleString('ru-RU')}`);
  console.log(`  SUM: ${crmOnlySum} + ${crmHigherSum} + (${excelHigherSum}) - ${excelOnlyDebtSum} - ${excelNoCrmSum} - ${unmatchedExcel}`);
  console.log(`     = ${(crmOnlySum + crmHigherSum + excelHigherSum - excelOnlyDebtSum - excelNoCrmSum - unmatchedExcel).toLocaleString('ru-RU')}`);
  console.log(`  Expected: ${(totalCrm - feb.total).toLocaleString('ru-RU')}`);

  // Write CSV
  const reportsDir = path.resolve(process.cwd(), '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const csvHeader = 'client_id,company_name,crm_debt,excel_closing,diff,category,deal_count,oldest_deal,newest_deal';
  const csvRows = rows.sort((a, b) => b.diff - a.diff).map(r =>
    `"${r.client_id}","${r.company_name}",${r.crm_gross},${r.excel_closing},${r.diff},"${r.category}",${r.deal_count},"${r.oldest_deal}","${r.newest_deal}"`
  );
  const csvPath = path.join(reportsDir, 'crm_vs_excel_gap_v2.csv');
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf8');
  console.log(`\nWritten: ${csvPath} (${rows.length} rows)`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
