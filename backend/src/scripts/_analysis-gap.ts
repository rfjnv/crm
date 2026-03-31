/**
 * Deep analysis: CRM (1,318M) vs Excel (1,013M) — where is the 305M gap?
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

function getClosingBalanceCol(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref'];
  if (!ref) return 26;
  const range = XLSX.utils.decode_range(ref);
  return range.e.c + 1 - 2;
}

/** Parse Excel: get per-client closing balance from the LATEST sheet they appear in */
function parseExcel(): Map<string, { closing: number; sheet: string; file: string }> {
  const FILES = ['29.12.2025.xlsx', '28.02.2026.xlsx'];
  const result = new Map<string, { closing: number; sheet: string; file: string }>();

  for (const fname of FILES) {
    const fpath = path.resolve(process.cwd(), '..', fname);
    if (!fs.existsSync(fpath)) continue;
    const wb = XLSX.readFile(fpath);

    for (const sheetName of wb.SheetNames) {
      const sn = sheetName.toLowerCase().trim();
      if (sn === 'лист1' || sn === 'лист2') continue;
      const ws = wb.Sheets[sheetName];
      const closingCol = getClosingBalanceCol(ws);
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

      for (let i = 3; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;
        const name = String(row[1] || '').trim().toLowerCase();
        if (!name) continue;
        const closing = numVal(row[closingCol]);
        result.set(name, { closing, sheet: sheetName, file: fname });
      }
    }
  }
  return result;
}

/** Sum ONLY Feb 2026 closing from 28.02.2026.xlsx (last sheet = февраль 2026) */
function parseFeb2026Only(): { total: number; clients: Map<string, number> } {
  const fname = '28.02.2026.xlsx';
  const fpath = path.resolve(process.cwd(), '..', fname);
  const clients = new Map<string, number>();
  let total = 0;

  if (!fs.existsSync(fpath)) return { total, clients };
  const wb = XLSX.readFile(fpath);

  // Last sheet = февраль 2026
  const lastSheet = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[lastSheet];
  const closingCol = getClosingBalanceCol(ws);
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = String(row[1] || '').trim().toLowerCase();
    if (!name) continue;
    const closing = numVal(row[closingCol]);
    clients.set(name, closing);
    total += closing;
  }

  console.log(`Excel Feb 2026 sheet "${lastSheet}": ${data.length - 3} clients, total closing: ${total.toLocaleString('ru-RU')}`);
  return { total, clients };
}

async function main() {
  console.log('=== DEEP ANALYSIS: CRM (1.318B) vs Excel (1.013B) ===\n');

  // ─── 1. Understand what "Excel = 1,013,072,673" means ───
  // The user quoted 1,013,072,673 — let's figure out which sheet/file this is from
  const allExcel = parseExcel();
  const feb2026 = parseFeb2026Only();

  // Also sum from ALL latest sheets
  let allExcelTotal = 0;
  for (const [, val] of allExcel) allExcelTotal += val.closing;
  console.log(`Excel ALL latest per client: ${allExcelTotal.toLocaleString('ru-RU')}`);
  console.log(`Excel Feb 2026 only: ${feb2026.total.toLocaleString('ru-RU')}\n`);

  // ─── 2. Get CRM debt per client ───
  const crmClients = await prisma.$queryRaw<{
    client_id: string;
    company_name: string;
    crm_gross: string;
    crm_net: string;
    deal_count: string;
    total_amount: string;
    total_paid: string;
    oldest_deal: string;
    newest_deal: string;
    has_items: string;
  }[]>(
    Prisma.sql`
    SELECT c.id AS client_id,
           c.company_name,
           COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text AS crm_gross,
           COALESCE(SUM(d.amount - d.paid_amount), 0)::text AS crm_net,
           COUNT(d.id)::text AS deal_count,
           COALESCE(SUM(d.amount), 0)::text AS total_amount,
           COALESCE(SUM(d.paid_amount), 0)::text AS total_paid,
           MIN(d.created_at)::date::text AS oldest_deal,
           MAX(d.created_at)::date::text AS newest_deal,
           (SELECT COUNT(*) FROM deal_items di WHERE di.deal_id = ANY(ARRAY_AGG(d.id)))::text AS has_items
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY c.id, c.company_name
    ORDER BY COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0) DESC`
  );

  // ─── 3. Build comparison ───
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
    if (crmGross <= 0) continue; // no debt

    const excelVal = feb2026.clients.get(name);
    const excelClosing = excelVal ?? allExcel.get(name)?.closing ?? 0;
    const inExcel = feb2026.clients.has(name) || allExcel.has(name);
    const diff = crmGross - excelClosing;

    // Categorize
    let category = '';
    if (!inExcel) {
      category = 'NOT_IN_EXCEL';
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

  // ─── 4. Summary by category ───
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
  console.log(`${'Category'.padEnd(15)} ${'Count'.padStart(6)} ${'CRM Debt'.padStart(18)} ${'Excel'.padStart(18)} ${'Diff'.padStart(18)}`);
  console.log('-'.repeat(80));
  let totalDiff = 0;
  for (const [cat, data] of [...categories].sort((a, b) => b[1].diffSum - a[1].diffSum)) {
    console.log(`${cat.padEnd(15)} ${String(data.count).padStart(6)} ${data.crmSum.toLocaleString('ru-RU').padStart(18)} ${data.excelSum.toLocaleString('ru-RU').padStart(18)} ${data.diffSum.toLocaleString('ru-RU').padStart(18)}`);
    totalDiff += data.diffSum;
  }
  console.log('-'.repeat(80));
  console.log(`${'TOTAL'.padEnd(15)} ${String(rows.length).padStart(6)} ${rows.reduce((s, r) => s + r.crm_gross, 0).toLocaleString('ru-RU').padStart(18)} ${rows.reduce((s, r) => s + r.excel_closing, 0).toLocaleString('ru-RU').padStart(18)} ${totalDiff.toLocaleString('ru-RU').padStart(18)}`);

  // ─── 5. NOT_IN_EXCEL clients (CRM-only) ───
  const notInExcel = rows.filter(r => r.category === 'NOT_IN_EXCEL').sort((a, b) => b.crm_gross - a.crm_gross);
  console.log(`\n=== CRM-ONLY CLIENTS (not in Excel): ${notInExcel.length} clients ===`);
  console.log(`${'Client'.padEnd(35)} ${'CRM Debt'.padStart(15)} ${'Deals'.padStart(6)} ${'Oldest'.padStart(12)} ${'Newest'.padStart(12)}`);
  for (const r of notInExcel.slice(0, 30)) {
    console.log(`${r.company_name.padEnd(35)} ${r.crm_gross.toLocaleString('ru-RU').padStart(15)} ${String(r.deal_count).padStart(6)} ${r.oldest_deal.padStart(12)} ${r.newest_deal.padStart(12)}`);
  }
  const notInExcelTotal = notInExcel.reduce((s, r) => s + r.crm_gross, 0);
  console.log(`CRM-only total debt: ${notInExcelTotal.toLocaleString('ru-RU')}`);

  // ─── 6. CRM_HIGHER clients (both in CRM and Excel, but CRM shows more) ───
  const crmHigher = rows.filter(r => r.category === 'CRM_HIGHER').sort((a, b) => b.diff - a.diff);
  console.log(`\n=== CRM > EXCEL: ${crmHigher.length} clients ===`);
  console.log(`${'Client'.padEnd(35)} ${'CRM'.padStart(15)} ${'Excel'.padStart(15)} ${'Diff'.padStart(15)} ${'Deals'.padStart(6)} ${'Oldest'.padStart(12)}`);
  for (const r of crmHigher.slice(0, 20)) {
    console.log(`${r.company_name.padEnd(35)} ${r.crm_gross.toLocaleString('ru-RU').padStart(15)} ${r.excel_closing.toLocaleString('ru-RU').padStart(15)} ${r.diff.toLocaleString('ru-RU').padStart(15)} ${String(r.deal_count).padStart(6)} ${r.oldest_deal.padStart(12)}`);
  }
  const crmHigherDiff = crmHigher.reduce((s, r) => s + r.diff, 0);
  console.log(`CRM>Excel total diff: ${crmHigherDiff.toLocaleString('ru-RU')}`);

  // ─── 7. EXCEL_HIGHER clients ───
  const excelHigher = rows.filter(r => r.category === 'EXCEL_HIGHER').sort((a, b) => a.diff - b.diff);
  console.log(`\n=== EXCEL > CRM: ${excelHigher.length} clients ===`);
  console.log(`${'Client'.padEnd(35)} ${'CRM'.padStart(15)} ${'Excel'.padStart(15)} ${'Diff'.padStart(15)}`);
  for (const r of excelHigher.slice(0, 20)) {
    console.log(`${r.company_name.padEnd(35)} ${r.crm_gross.toLocaleString('ru-RU').padStart(15)} ${r.excel_closing.toLocaleString('ru-RU').padStart(15)} ${r.diff.toLocaleString('ru-RU').padStart(15)}`);
  }

  // ─── 8. Analyze CRM-only deals: WHY aren't they in Excel? ───
  console.log('\n=== ANALYSIS: WHY ARE CRM-ONLY CLIENTS NOT IN EXCEL? ===');

  // Check if these clients have deals with items (products)
  if (notInExcel.length > 0) {
    const notInExcelIds = notInExcel.map(r => r.client_id);
    const dealAnalysis = await prisma.$queryRaw<{
      client_id: string;
      company_name: string;
      total_deals: string;
      unpaid_deals: string;
      deals_with_items: string;
      deals_without_items: string;
      oldest: string;
      newest: string;
      total_debt: string;
      year_dist: string;
    }[]>(
      Prisma.sql`
      WITH deal_data AS (
        SELECT d.id, d.client_id, d.amount, d.paid_amount, d.created_at,
               (SELECT COUNT(*) FROM deal_items di WHERE di.deal_id = d.id) AS item_count
        FROM deals d
        WHERE d.client_id = ANY(${notInExcelIds})
          AND d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')
          AND d.amount > d.paid_amount
      )
      SELECT dd.client_id, c.company_name,
             COUNT(*)::text AS total_deals,
             COUNT(*) FILTER (WHERE dd.amount > dd.paid_amount)::text AS unpaid_deals,
             COUNT(*) FILTER (WHERE dd.item_count > 0)::text AS deals_with_items,
             COUNT(*) FILTER (WHERE dd.item_count = 0)::text AS deals_without_items,
             MIN(dd.created_at)::date::text AS oldest,
             MAX(dd.created_at)::date::text AS newest,
             SUM(GREATEST(dd.amount - dd.paid_amount, 0))::text AS total_debt,
             STRING_AGG(DISTINCT EXTRACT(YEAR FROM dd.created_at)::text, ',' ORDER BY EXTRACT(YEAR FROM dd.created_at)::text) AS year_dist
      FROM deal_data dd
      JOIN clients c ON c.id = dd.client_id
      GROUP BY dd.client_id, c.company_name
      ORDER BY SUM(GREATEST(dd.amount - dd.paid_amount, 0)) DESC
      LIMIT 20`
    );

    console.log(`${'Client'.padEnd(30)} ${'Debt'.padStart(15)} ${'Deals'.padStart(6)} ${'w/Items'.padStart(8)} ${'no/Items'.padStart(9)} ${'Oldest'.padStart(12)} ${'Years'.padStart(12)}`);
    for (const d of dealAnalysis) {
      console.log(`${d.company_name.substring(0, 30).padEnd(30)} ${Number(d.total_debt).toLocaleString('ru-RU').padStart(15)} ${d.total_deals.padStart(6)} ${d.deals_with_items.padStart(8)} ${d.deals_without_items.padStart(9)} ${d.oldest.padStart(12)} ${d.year_dist.padStart(12)}`);
    }
  }

  // ─── 9. For CRM_HIGHER, check the extra deals ───
  console.log('\n=== WHY CRM > EXCEL (top clients) ===');
  for (const r of crmHigher.slice(0, 5)) {
    const deals = await prisma.$queryRaw<{
      id: string;
      title: string;
      amount: string;
      paid_amount: string;
      debt: string;
      created_at: string;
      item_count: string;
      payment_status: string;
    }[]>(
      Prisma.sql`
      SELECT d.id, d.title, d.amount::text, d.paid_amount::text,
             GREATEST(d.amount - d.paid_amount, 0)::text AS debt,
             d.created_at::date::text,
             (SELECT COUNT(*) FROM deal_items di WHERE di.deal_id = d.id)::text AS item_count,
             d.payment_status
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
    for (const d of deals.slice(0, 10)) {
      console.log(`  ${(d.title || '(no title)').substring(0, 40).padEnd(40)} ${Number(d.amount).toLocaleString('ru-RU').padStart(12)} ${Number(d.paid_amount).toLocaleString('ru-RU').padStart(12)} ${Number(d.debt).toLocaleString('ru-RU').padStart(12)} ${d.created_at.padStart(12)} ${d.item_count.padStart(6)}`);
    }
  }

  // ─── 10. Global summary ───
  const matchCount = rows.filter(r => r.category === 'MATCH').length;
  console.log('\n=== FINAL SUMMARY ===');
  console.log(`CRM total gross debt:          ${rows.reduce((s, r) => s + r.crm_gross, 0).toLocaleString('ru-RU')}`);
  console.log(`Excel total closing:           ${rows.reduce((s, r) => s + r.excel_closing, 0).toLocaleString('ru-RU')}`);
  console.log(`Gap:                           ${totalDiff.toLocaleString('ru-RU')}`);
  console.log(`  from NOT_IN_EXCEL:           ${notInExcelTotal.toLocaleString('ru-RU')} (${notInExcel.length} clients)`);
  console.log(`  from CRM_HIGHER:             ${crmHigherDiff.toLocaleString('ru-RU')} (${crmHigher.length} clients)`);
  console.log(`  from EXCEL_HIGHER:           ${excelHigher.reduce((s, r) => s + r.diff, 0).toLocaleString('ru-RU')} (${excelHigher.length} clients)`);
  console.log(`  MATCH:                       ${matchCount} clients`);

  // Write CSV
  const reportsDir = path.resolve(process.cwd(), '..', 'reports');
  const csvHeader = 'client_id,company_name,crm_debt,excel_closing,diff,category,deal_count,oldest_deal,newest_deal';
  const csvRows = rows.sort((a, b) => b.diff - a.diff).map(r =>
    `"${r.client_id}","${r.company_name}",${r.crm_gross},${r.excel_closing},${r.diff},"${r.category}",${r.deal_count},"${r.oldest_deal}","${r.newest_deal}"`
  );
  const csvPath = path.join(reportsDir, 'crm_vs_excel_gap.csv');
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf8');
  console.log(`\nWritten: ${csvPath}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
