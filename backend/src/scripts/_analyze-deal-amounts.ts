/**
 * Analyze deal amount discrepancy:
 * CRM total deal amounts (31.78B) vs expected from Excel (~23.9B)
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';

const prisma = new PrismaClient();

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

async function main() {
  // ─── CRM side ───
  // 1. Deals per year-month
  const perMonth = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT
      TO_CHAR(created_at, 'YYYY-MM') as ym,
      COUNT(*)::text as cnt,
      SUM(amount)::text as amt,
      SUM(paid_amount)::text as paid,
      SUM(GREATEST(amount - paid_amount, 0))::text as debt
    FROM deals WHERE is_archived = false
    GROUP BY TO_CHAR(created_at, 'YYYY-MM')
    ORDER BY ym`
  );
  console.log('=== CRM Deals per month ===');
  for (const r of perMonth) {
    console.log(`  ${r.ym}: ${r.cnt} deals, amt=${Number(r.amt).toLocaleString()}, paid=${Number(r.paid).toLocaleString()}, debt=${Number(r.debt).toLocaleString()}`);
  }

  // 2. Total deal amounts vs items
  const totals = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT
      SUM(d.amount)::text as deal_total,
      COALESCE(SUM(items.t), 0)::text as items_total
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(requested_qty * price) as t FROM deal_items GROUP BY deal_id) items ON items.deal_id = d.id
    WHERE d.is_archived = false`
  );
  console.log(`\n=== CRM Totals ===`);
  console.log(`  Deal amounts: ${Number(totals[0].deal_total).toLocaleString()}`);
  console.log(`  Items sum: ${Number(totals[0].items_total).toLocaleString()}`);
  console.log(`  Diff: ${(Number(totals[0].deal_total) - Number(totals[0].items_total)).toLocaleString()}`);

  // 3. Deals without items but with amount > 0
  const noItems = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT COUNT(*)::text as cnt, COALESCE(SUM(d.amount), 0)::text as amt
    FROM deals d
    LEFT JOIN deal_items di ON di.deal_id = d.id
    WHERE d.is_archived = false AND di.id IS NULL AND d.amount > 0`
  );
  console.log(`\n  Deals w/o items (amount>0): ${noItems[0].cnt}, total=${Number(noItems[0].amt).toLocaleString()}`);

  // 4. Top 15 deals where amount >> sum(items)
  const mismatch = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT
      d.title, d.amount::text as deal_amt, c.company_name,
      COALESCE(SUM(di.requested_qty * di.price), 0)::text as items_sum
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN deal_items di ON di.deal_id = d.id
    WHERE d.is_archived = false
    GROUP BY d.id, d.title, d.amount, c.company_name
    HAVING d.amount - COALESCE(SUM(di.requested_qty * di.price), 0) > 1000000
    ORDER BY d.amount - COALESCE(SUM(di.requested_qty * di.price), 0) DESC
    LIMIT 15`
  );
  console.log('\n=== Top 15 deals: amount > items (diff > 1M) ===');
  for (const r of mismatch) {
    const diff = Number(r.deal_amt) - Number(r.items_sum);
    console.log(`  "${r.company_name}" "${r.title}" deal=${Number(r.deal_amt).toLocaleString()} items=${Number(r.items_sum).toLocaleString()} diff=${diff.toLocaleString()}`);
  }

  // ─── Excel side ───
  // 5. Sum all Excel sales (col 8 = price*qty total per row)
  const MONTH_NAMES = [ 'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь' ];
  const files = [
    { name: '29.12.2025.xlsx', defaultYear: 2025 },
    { name: '28.02.2026.xlsx', defaultYear: 2026 },
  ];

  let grandExcelSales = 0;
  console.log('\n=== Excel sales per month ===');

  for (const file of files) {
    const fpath = path.resolve(process.cwd(), '..', file.name);
    const wb = XLSX.readFile(fpath);

    for (const sheetName of wb.SheetNames) {
      const sn = sheetName.toLowerCase().trim();
      if (sn === 'лист1' || sn === 'лист2') continue;

      let monthIdx = -1;
      for (let m = 0; m < MONTH_NAMES.length; m++) {
        if (sn.startsWith(MONTH_NAMES[m])) { monthIdx = m; break; }
      }
      if (monthIdx < 0) continue;

      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

      // Sum column 8 (total sale amount per row) for all data rows
      let sheetSales = 0;
      let rowCount = 0;
      for (let i = 3; i < data.length; i++) {
        const row = data[i] as unknown[];
        if (!row) continue;
        const client = String(row[1] || '').trim();
        if (!client) continue;
        const sale = numVal(row[8]);
        if (sale > 0) {
          sheetSales += sale;
          rowCount++;
        }
      }
      grandExcelSales += sheetSales;
      console.log(`  ${sheetName}: ${rowCount} rows, sales=${sheetSales.toLocaleString()}`);
    }
  }

  console.log(`\n=== COMPARISON ===`);
  console.log(`  CRM deal amounts: ${Number(totals[0].deal_total).toLocaleString()}`);
  console.log(`  Excel total sales: ${grandExcelSales.toLocaleString()}`);
  console.log(`  Difference: ${(Number(totals[0].deal_total) - grandExcelSales).toLocaleString()}`);

  // 6. Per-client comparison: CRM total deal amount vs Excel total sales
  const crmPerClient = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT c.company_name, SUM(d.amount)::text as total_amt, COUNT(d.id)::text as deals
    FROM deals d JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
    GROUP BY c.id, c.company_name
    ORDER BY SUM(d.amount) DESC`
  );

  // Build Excel sales per client
  const excelSalesPerClient = new Map<string, number>();
  for (const file of files) {
    const fpath = path.resolve(process.cwd(), '..', file.name);
    const wb = XLSX.readFile(fpath);
    for (const sheetName of wb.SheetNames) {
      const sn = sheetName.toLowerCase().trim();
      if (sn === 'лист1' || sn === 'лист2') continue;
      let monthIdx = -1;
      for (let m = 0; m < MONTH_NAMES.length; m++) {
        if (sn.startsWith(MONTH_NAMES[m])) { monthIdx = m; break; }
      }
      if (monthIdx < 0) continue;
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
      for (let i = 3; i < data.length; i++) {
        const row = data[i] as unknown[];
        if (!row) continue;
        const client = String(row[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!client) continue;
        const sale = numVal(row[8]);
        if (sale > 0) {
          excelSalesPerClient.set(client, (excelSalesPerClient.get(client) || 0) + sale);
        }
      }
    }
  }

  // Compare top 20 clients by CRM amount
  console.log('\n=== Top 20 clients: CRM amount vs Excel sales ===');
  for (const c of crmPerClient.slice(0, 25)) {
    const key = c.company_name.toLowerCase().trim().replace(/\s+/g, ' ');
    const excelSale = excelSalesPerClient.get(key) || 0;
    const diff = Number(c.total_amt) - excelSale;
    if (Math.abs(diff) > 100000) {
      console.log(`  "${c.company_name}" (${c.deals} deals): CRM=${Number(c.total_amt).toLocaleString()} Excel=${excelSale.toLocaleString()} DIFF=${diff.toLocaleString()}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
