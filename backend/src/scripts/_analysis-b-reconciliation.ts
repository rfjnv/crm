/**
 * Section B (enhanced): Client-level reconciliation CSV with all requested columns.
 * Columns: client_id, company_name, crm_gross, crm_net, excel_closing, diff,
 *          deals_count, payments_count, sum_payments
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
  const totalCols = range.e.c + 1;
  return totalCols - 2;
}

interface ExcelClient {
  name: string;
  closingBalance: number;
  sheet: string;
}

function parseExcelClosingBalances(): Map<string, ExcelClient> {
  const FILES = ['29.12.2025.xlsx', '28.02.2026.xlsx'];
  const result = new Map<string, ExcelClient>();

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
        const clientName = String(row[1] || '').trim().toLowerCase();
        if (!clientName) continue;
        const closing = numVal(row[closingCol]);
        result.set(clientName, { name: String(row[1] || '').trim(), closingBalance: closing, sheet: sheetName });
      }
    }
  }
  return result;
}

async function main() {
  console.log('=== SECTION B (enhanced): CLIENT-LEVEL RECONCILIATION ===\n');

  const reportsDir = path.resolve(process.cwd(), '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  // CRM data per client — with client_id, payments_count, sum_payments
  const crmData = await prisma.$queryRaw<{
    client_id: string;
    company_name: string;
    deal_count: string;
    crm_gross: string;
    crm_net: string;
    total_amount: string;
    total_paid_amount: string;
    payments_count: string;
    sum_payments: string;
  }[]>(
    Prisma.sql`
    SELECT c.id AS client_id,
           c.company_name,
           COUNT(DISTINCT d.id)::text AS deal_count,
           SUM(GREATEST(d.amount - COALESCE(d.paid_amount, 0), 0))::text AS crm_gross,
           SUM(d.amount - COALESCE(d.paid_amount, 0))::text AS crm_net,
           SUM(d.amount)::text AS total_amount,
           SUM(COALESCE(d.paid_amount, 0))::text AS total_paid_amount,
           (SELECT COUNT(*)::text FROM payments p2 WHERE p2.client_id = c.id) AS payments_count,
           (SELECT COALESCE(SUM(p3.amount), 0)::text FROM payments p3 WHERE p3.client_id = c.id) AS sum_payments
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY c.id, c.company_name
    ORDER BY c.company_name`
  );

  const excelMap = parseExcelClosingBalances();

  // Build rows
  interface Row {
    client_id: string;
    company_name: string;
    crm_gross: number;
    crm_net: number;
    excel_closing: number;
    diff: number;
    abs_diff: number;
    deals_count: number;
    payments_count: number;
    sum_payments: number;
  }

  const rows: Row[] = [];

  for (const c of crmData) {
    const excelEntry = excelMap.get(c.company_name.trim().toLowerCase());
    const crmGross = Number(c.crm_gross);
    const excelClosing = excelEntry?.closingBalance ?? 0;

    rows.push({
      client_id: c.client_id,
      company_name: c.company_name.trim(),
      crm_gross: crmGross,
      crm_net: Number(c.crm_net),
      excel_closing: excelClosing,
      diff: crmGross - excelClosing,
      abs_diff: Math.abs(crmGross - excelClosing),
      deals_count: Number(c.deal_count),
      payments_count: Number(c.payments_count),
      sum_payments: Number(c.sum_payments),
    });
  }

  // Excel-only clients
  const crmNames = new Set(crmData.map(c => c.company_name.trim().toLowerCase()));
  for (const [key, val] of excelMap) {
    if (!crmNames.has(key) && val.closingBalance !== 0) {
      rows.push({
        client_id: '',
        company_name: val.name,
        crm_gross: 0,
        crm_net: 0,
        excel_closing: val.closingBalance,
        diff: -val.closingBalance,
        abs_diff: Math.abs(val.closingBalance),
        deals_count: 0,
        payments_count: 0,
        sum_payments: 0,
      });
    }
  }

  // Full reconciliation CSV
  const csvHeader = 'client_id,company_name,crm_gross,crm_net,excel_closing,diff,deals_count,payments_count,sum_payments';
  const csvRows = rows.map(r =>
    `"${r.client_id}","${r.company_name}",${r.crm_gross},${r.crm_net},${r.excel_closing},${r.diff},${r.deals_count},${r.payments_count},${r.sum_payments}`
  );
  const csvPath = path.join(reportsDir, 'reconciliation_2026-02-28.csv');
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf8');
  console.log(`Written: ${csvPath} (${rows.length} rows)`);

  // Top 50 discrepancies
  const top50 = rows.filter(r => r.abs_diff > 0).sort((a, b) => b.abs_diff - a.abs_diff).slice(0, 50);
  const topCsvRows = top50.map(r =>
    `"${r.client_id}","${r.company_name}",${r.crm_gross},${r.crm_net},${r.excel_closing},${r.diff},${r.deals_count},${r.payments_count},${r.sum_payments}`
  );
  const topCsvPath = path.join(reportsDir, 'top_discrepancies.csv');
  fs.writeFileSync(topCsvPath, [csvHeader, ...topCsvRows].join('\n'), 'utf8');
  console.log(`Written: ${topCsvPath} (${top50.length} rows)`);

  // Summary
  const totalCrmGross = rows.reduce((s, r) => s + r.crm_gross, 0);
  const totalExcel = rows.reduce((s, r) => s + r.excel_closing, 0);
  const matched = rows.filter(r => r.excel_closing !== 0 || r.client_id === '').length;

  console.log(`\nSummary:`);
  console.log(`  Total rows: ${rows.length}`);
  console.log(`  Total CRM gross: ${totalCrmGross.toLocaleString('ru-RU')}`);
  console.log(`  Total Excel closing: ${totalExcel.toLocaleString('ru-RU')}`);
  console.log(`  Difference: ${(totalCrmGross - totalExcel).toLocaleString('ru-RU')}`);

  console.log(`\nTop 10 discrepancies:`);
  console.log(`${'Client'.padEnd(35)} ${'CRM_Gross'.padStart(15)} ${'Excel'.padStart(15)} ${'Diff'.padStart(15)} ${'#Pay'.padStart(6)} ${'SumPay'.padStart(15)}`);
  for (const r of top50.slice(0, 10)) {
    console.log(`${r.company_name.padEnd(35)} ${r.crm_gross.toLocaleString('ru-RU').padStart(15)} ${r.excel_closing.toLocaleString('ru-RU').padStart(15)} ${r.diff.toLocaleString('ru-RU').padStart(15)} ${String(r.payments_count).padStart(6)} ${r.sum_payments.toLocaleString('ru-RU').padStart(15)}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
