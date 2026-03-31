import * as XLSX from 'xlsx';
import path from 'path';

const filePath = path.resolve(process.cwd(), '../остаток 02 (3).xlsx');
const wb = XLSX.readFile(filePath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

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

// Build map: name+format → last stock value (Map overwrites = last wins)
const excelMap = new Map<string, { name: string; format: string; stock: number; row: number }>();

for (let i = 3; i < data.length; i++) {
  const row = data[i] as unknown[];
  if (!row?.[1]) continue;
  const name = norm(row[1]);
  const format = norm(row[2]);
  const stock = parseStock(row[7]);
  const key = name.toLowerCase() + '|||' + format.toLowerCase();
  excelMap.set(key, { name, format, stock, row: i });
}

// Print in a format easy to parse
let idx = 0;
for (const [key, val] of excelMap.entries()) {
  idx++;
  console.log(`${idx}. "${val.name}" | "${val.format}" | stock=${val.stock}`);
}
console.log(`\nTotal: ${excelMap.size}`);
