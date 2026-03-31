/**
 * Backfill deal_items.deal_date from Excel files.
 *
 * For each Excel row: Column A = date, we match it to a deal_item by:
 * - Deal title pattern: "{client} — {Month} {Year}"
 * - Product name, qty, price match
 *
 * Run: cd backend && npx ts-node src/scripts/backfill-deal-dates.ts
 */
import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

// Column indices (same as import-excel.ts)
const COL_DATE = 0;
const COL_CLIENT = 1;
const COL_PRODUCT = 4;
const COL_QTY = 5;
const COL_PRICE = 7;

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }
  return null;
}

interface ExcelRow {
  date: Date;
  clientName: string;
  productName: string;
  qty: number;
  price: number;
}

async function processFile(filePath: string, year: number) {
  console.log(`\n=== Processing ${path.basename(filePath)} (year=${year}) ===`);
  const wb = XLSX.readFile(filePath);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNotFound = 0;

  for (let monthIdx = 0; monthIdx < wb.SheetNames.length; monthIdx++) {
    const sheetName = wb.SheetNames[monthIdx];
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // Detect which month this sheet represents
    const monthMatch = MONTH_NAMES_RU.findIndex(m =>
      sheetName.toLowerCase().includes(m.toLowerCase())
    );
    if (monthMatch === -1) {
      console.log(`  Skipping sheet "${sheetName}" (no month match)`);
      continue;
    }
    const monthName = MONTH_NAMES_RU[monthMatch];

    const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });
    const monthStart = new Date(Date.UTC(year, monthMatch, 1));
    const monthEnd = new Date(Date.UTC(year, monthMatch + 1, 1));

    // Collect Excel rows with dates within this month
    const excelRows: ExcelRow[] = [];
    for (const row of rows) {
      const rowDate = toDate(row[COL_DATE]);
      if (!rowDate || rowDate < monthStart || rowDate >= monthEnd) continue;

      const clientName = norm(row[COL_CLIENT]);
      const productName = norm(row[COL_PRODUCT]);
      const qty = numVal(row[COL_QTY]);
      const price = numVal(row[COL_PRICE]);

      if (!clientName || !productName || qty <= 0) continue;

      excelRows.push({ date: rowDate, clientName, productName, qty, price });
    }

    if (excelRows.length === 0) continue;

    // Find all deals for this month
    const dealTitleSuffix = `— ${monthName} ${year}`;
    const deals = await prisma.deal.findMany({
      where: {
        title: { endsWith: dealTitleSuffix },
        isArchived: false,
      },
      include: {
        items: {
          include: { product: true },
        },
        client: true,
      },
    });

    console.log(`  Sheet "${sheetName}" (${monthName} ${year}): ${excelRows.length} Excel rows, ${deals.length} deals in DB`);

    // For each Excel row, find matching deal_item
    for (const excelRow of excelRows) {
      // Find deal by client name match
      const deal = deals.find(d => {
        const dealClient = d.client.companyName.toLowerCase().trim();
        const excelClient = excelRow.clientName.toLowerCase().trim();
        return dealClient === excelClient ||
               d.title.toLowerCase().includes(excelClient);
      });

      if (!deal) {
        totalNotFound++;
        continue;
      }

      // Find matching item by product name + qty + price (not yet assigned a date)
      const matchingItem = deal.items.find(item => {
        if (item.dealDate) return false; // Already has a date
        const prodMatch = item.product.name.toLowerCase().trim() === excelRow.productName.toLowerCase().trim();
        const qtyMatch = Math.abs(Number(item.requestedQty) - excelRow.qty) < 0.01;
        const priceMatch = Math.abs(Number(item.price) - excelRow.price) < 0.01;
        return prodMatch && qtyMatch && priceMatch;
      });

      if (matchingItem) {
        await prisma.dealItem.update({
          where: { id: matchingItem.id },
          data: { dealDate: excelRow.date },
        });
        matchingItem.dealDate = excelRow.date; // Mark as used
        totalUpdated++;
      } else {
        totalSkipped++;
      }
    }

    console.log(`    Updated: ${totalUpdated}, Skipped: ${totalSkipped}, Not found: ${totalNotFound}`);
  }

  return { totalUpdated, totalSkipped, totalNotFound };
}

async function main() {
  const files = [
    { path: path.resolve(__dirname, '../../../analytics_2024-12-26.xlsx'), year: 2024 },
    { path: path.resolve(__dirname, '../../../analytics_2025-12-29.xlsx'), year: 2025 },
    { path: path.resolve(__dirname, '../../../analytics_2026-03-12.xlsx'), year: 2026 },
  ];

  let grandTotal = { updated: 0, skipped: 0, notFound: 0 };

  for (const file of files) {
    try {
      const result = await processFile(file.path, file.year);
      grandTotal.updated += result.totalUpdated;
      grandTotal.skipped += result.totalSkipped;
      grandTotal.notFound += result.totalNotFound;
    } catch (err) {
      console.error(`Error processing ${file.path}:`, (err as Error).message);
    }
  }

  console.log('\n=== GRAND TOTAL ===');
  console.log(`Updated: ${grandTotal.updated}`);
  console.log(`Skipped: ${grandTotal.skipped}`);
  console.log(`Not found: ${grandTotal.notFound}`);

  // Verify: check items with and without deal_date
  const stats = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) FILTER (WHERE deal_date IS NOT NULL)::text as with_date,
      COUNT(*) FILTER (WHERE deal_date IS NULL)::text as without_date,
      COUNT(*)::text as total
    FROM deal_items
  `;
  console.log('\n=== deal_items stats ===');
  console.log(`With date: ${stats[0].with_date}, Without date: ${stats[0].without_date}, Total: ${stats[0].total}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
