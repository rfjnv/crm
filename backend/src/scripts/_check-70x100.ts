import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';
const prisma = new PrismaClient();

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

async function main() {
  // 1. Check all DB products matching "70*100" or "самоклеющ" or "70x100"
  const allProducts = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sku: true, stock: true, unit: true, format: true },
    orderBy: { name: 'asc' },
  });

  console.log('=== DB products matching 70*100 / самоклеющ ===');
  for (const p of allProducts) {
    const n = (p.name + ' ' + (p.format || '') + ' ' + p.sku).toLowerCase();
    if (n.includes('70') && (n.includes('100') || n.includes('самоклеющ'))) {
      console.log(`  SKU=${p.sku}  name="${p.name}"  format="${p.format}"  stock=${Number(p.stock)}  unit=${p.unit}`);
    }
  }

  // Also search by any SKU containing "SK" or "CN"
  console.log('\n=== DB products with SKU containing SK or CN or 70 ===');
  for (const p of allProducts) {
    if (p.sku.includes('SK') || p.sku.includes('CN') || p.sku.includes('70x')) {
      console.log(`  SKU=${p.sku}  name="${p.name}"  stock=${Number(p.stock)}`);
    }
  }

  // 2. Check Excel file for 70*100 rows
  console.log('\n=== Excel rows matching 70*100 ===');
  const filePath = path.resolve(process.cwd(), '../остаток 02 (3).xlsx');
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  for (let i = 3; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row?.[1]) continue;
    const name = norm(row[1]);
    const format = norm(row[2]);
    if ((name + format).toLowerCase().includes('70') && (name + format).toLowerCase().includes('100')) {
      console.log(`  Row ${i}: name="${name.substring(0, 60)}"  fmt="${format}"  unit="${norm(row[3])}"  col4=${row[4]}  col5=${row[5]}  col6=${row[6]}  col7=${row[7]}`);
    }
  }

  await prisma.$disconnect();
}
main();
