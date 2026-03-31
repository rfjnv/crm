import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

/**
 * Reads the Excel file, takes ONLY the last occurrence of each product
 * (= the most recent date section), and prints the stock values.
 * These should be used to update import-stock.ts.
 */

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function parseStock(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (!str) return 0;
  const n = parseFloat(str.replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

const filePath = path.resolve(process.cwd(), '../остаток 02 (3).xlsx');
const wb = XLSX.readFile(filePath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

// Build map: name+format → last stock value (Map overwrites = last wins)
const excelMap = new Map<string, { name: string; format: string; stock: number; row: number }>();

for (let i = 3; i < data.length; i++) {
  const row = data[i] as unknown[];
  if (!row?.[1]) continue;
  const name = norm(row[1]);
  const format = norm(row[2]);
  const stock = parseStock(row[7]); // col 7 = latest date column
  const key = name.toLowerCase() + '|||' + format.toLowerCase();
  excelMap.set(key, { name, format, stock, row: i });
}

console.log(`Total unique products in Excel (last section): ${excelMap.size}`);

// Now read import-stock.ts and find each product's format, match to Excel
const importStockPath = path.resolve(__dirname, '../../prisma/import-stock.ts');
const content = fs.readFileSync(importStockPath, 'utf-8');

// Extract all products from the TypeScript file
const productRegex = /\{ name: '([^']+)', sku: '([^']+)', unit: '([^']+)', format: (?:'([^']*)'|null), .+?, stock: ([\d.]+) \}/g;
let match;
let updated = 0;
let notFound = 0;
let same = 0;
let newContent = content;

while ((match = productRegex.exec(content)) !== null) {
  const [fullMatch, name, sku, unit, format, stockStr] = match;
  const oldStock = parseFloat(stockStr);

  // Try to find in Excel by name (Excel names are longer, need heuristic match)
  // The import-stock.ts already has the Excel name in the 'name' field
  // Try exact name+format match first
  let found = false;
  for (const [key, val] of excelMap.entries()) {
    const excelName = val.name.toLowerCase();
    const excelFmt = val.format.toLowerCase();
    const tsName = name.toLowerCase();
    const tsFmt = (format || '').toLowerCase();

    // Match by name similarity
    if (excelName.includes(tsName.substring(0, 20)) || tsName.includes(excelName.substring(0, 20))) {
      // Also check format
      if (excelFmt === tsFmt || excelFmt.includes(tsFmt) || tsFmt.includes(excelFmt)) {
        if (val.stock !== oldStock) {
          console.log(`  ${sku}: ${oldStock} → ${val.stock} (Excel row ${val.row})`);
          newContent = newContent.replace(fullMatch, fullMatch.replace(`stock: ${stockStr}`, `stock: ${val.stock}`));
          updated++;
        } else {
          same++;
        }
        found = true;
        break;
      }
    }
  }

  if (!found) {
    // Try matching by format field only (for products with unique formats)
    for (const [key, val] of excelMap.entries()) {
      const excelFmt = val.format.toLowerCase();
      const tsFmt = (format || '').toLowerCase();
      if (tsFmt && excelFmt === tsFmt) {
        if (val.stock !== oldStock) {
          console.log(`  ${sku}: ${oldStock} → ${val.stock} (fmt match, row ${val.row})`);
          newContent = newContent.replace(fullMatch, fullMatch.replace(`stock: ${stockStr}`, `stock: ${val.stock}`));
          updated++;
        } else {
          same++;
        }
        found = true;
        break;
      }
    }
  }

  if (!found) {
    notFound++;
    console.log(`  ? ${sku} "${name}" format="${format}" — no Excel match`);
  }
}

fs.writeFileSync(importStockPath, newContent);
console.log(`\nUpdated: ${updated}, Same: ${same}, Not found: ${notFound}`);
