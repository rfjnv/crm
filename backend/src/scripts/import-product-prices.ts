import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

function norm(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function excelDate(v: unknown): Date | null {
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
    return null;
  }
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

type PriceRow = {
  productRaw: string;
  productKey: string;
  price: number;
  date: Date | null;
  sheet: string;
  rowNo: number;
};

async function main() {
  const fileArg = process.argv[2] || '../analytics_2026-03-18.xlsx';
  const apply = process.argv.includes('--apply');

  const filePath = path.resolve(process.cwd(), fileArg);
  const wb = XLSX.readFile(filePath);

  const rows: PriceRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

    for (let i = 3; i < data.length; i++) {
      const row = data[i] || [];
      const productRaw = String(row[4] ?? '').trim();
      const productKey = norm(productRaw);
      const price = numVal(row[7]);
      if (!productKey || price <= 0) continue;

      rows.push({
        productRaw,
        productKey,
        price,
        date: excelDate(row[0]),
        sheet: sheetName,
        rowNo: i + 1,
      });
    }
  }

  const latestByProduct = new Map<string, PriceRow>();
  for (const r of rows) {
    const prev = latestByProduct.get(r.productKey);
    if (!prev) {
      latestByProduct.set(r.productKey, r);
      continue;
    }
    const prevTs = prev.date ? prev.date.getTime() : -1;
    const curTs = r.date ? r.date.getTime() : -1;
    if (curTs > prevTs || (curTs === prevTs && r.rowNo > prev.rowNo)) {
      latestByProduct.set(r.productKey, r);
    }
  }

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sku: true, salePrice: true },
  });

  const bySku = new Map<string, typeof products[number]>();
  const byName = new Map<string, typeof products[number]>();
  for (const p of products) {
    bySku.set(norm(p.sku), p);
    byName.set(norm(p.name), p);
  }

  const matched: Array<{ productId: string; sku: string; name: string; oldPrice: number | null; newPrice: number; source: PriceRow; mode: 'sku' | 'name' }> = [];
  const unmatched: PriceRow[] = [];

  for (const row of latestByProduct.values()) {
    const skuHit = bySku.get(row.productKey);
    if (skuHit) {
      matched.push({
        productId: skuHit.id,
        sku: skuHit.sku,
        name: skuHit.name,
        oldPrice: skuHit.salePrice != null ? Number(skuHit.salePrice) : null,
        newPrice: row.price,
        source: row,
        mode: 'sku',
      });
      continue;
    }

    const nameHit = byName.get(row.productKey);
    if (nameHit) {
      matched.push({
        productId: nameHit.id,
        sku: nameHit.sku,
        name: nameHit.name,
        oldPrice: nameHit.salePrice != null ? Number(nameHit.salePrice) : null,
        newPrice: row.price,
        source: row,
        mode: 'name',
      });
      continue;
    }

    unmatched.push(row);
  }

  const toUpdate = matched.filter((m) => m.oldPrice == null || Math.abs((m.oldPrice ?? 0) - m.newPrice) > 0.009);

  console.log(`File: ${filePath}`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Excel rows with price > 0: ${rows.length}`);
  console.log(`Unique excel products with latest price: ${latestByProduct.size}`);
  console.log(`Matched products: ${matched.length}`);
  console.log(`Unmatched products: ${unmatched.length}`);
  console.log(`Will update salePrice: ${toUpdate.length}`);

  if (unmatched.length > 0) {
    console.log('\nTop unmatched (first 40):');
    for (const u of unmatched.slice(0, 40)) {
      const dt = u.date ? u.date.toISOString().slice(0, 10) : 'no-date';
      console.log(`  ${u.productRaw} | price=${u.price} | ${u.sheet}:${u.rowNo} | ${dt}`);
    }
  }

  if (!apply) return;

  let updated = 0;
  for (const row of toUpdate) {
    await prisma.product.update({
      where: { id: row.productId },
      data: { salePrice: row.newPrice },
    });
    updated++;
  }

  console.log(`\nUpdated salePrice for ${updated} products.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

