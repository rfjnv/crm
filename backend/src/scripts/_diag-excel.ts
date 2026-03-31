/**
 * Quick diagnostic: what column is closingCol pointing to in Feb 2026 sheet?
 */
import XLSX from 'xlsx';
import path from 'path';

const fpath = path.resolve(process.cwd(), '..', '28.02.2026.xlsx');
const wb = XLSX.readFile(fpath);
const lastSheet = wb.SheetNames[wb.SheetNames.length - 1];
const ws = wb.Sheets[lastSheet];
const ref = ws['!ref']!;
const range = XLSX.utils.decode_range(ref);

console.log('Sheet:', lastSheet);
console.log('Range:', ref);
console.log('Columns:', range.s.c, 'to', range.e.c, '(' + (range.e.c + 1) + ' total)');
const closingCol = range.e.c + 1 - 2;
console.log('closingCol:', closingCol);

const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
console.log('Rows:', data.length);

// Show first few rows
for (let i = 0; i < Math.min(5, data.length); i++) {
  const row = data[i] as unknown[];
  if (!row) continue;
  const name = String(row[1] || '').trim();
  console.log(`Row ${i}: name="${name.substring(0, 25)}" col[${closingCol}]=${JSON.stringify(row[closingCol])} col[${range.e.c}]=${JSON.stringify(row[range.e.c])}`);
}

// Show a few data rows
function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

let count = 0;
let total = 0;
for (let i = 3; i < data.length; i++) {
  const row = data[i] as unknown[];
  if (!row) continue;
  const name = String(row[1] || '').trim();
  if (!name) continue;
  count++;
  total += numVal(row[closingCol]);
  if (count <= 5) {
    console.log(`  Data[${i}]: "${name.substring(0, 25)}" closing=${numVal(row[closingCol]).toLocaleString('ru-RU')}`);
  }
}
console.log(`Total clients: ${count}, Total closing: ${total.toLocaleString('ru-RU')}`);

// Also check ALL sheets' client counts
console.log('\nAll sheets in 28.02.2026.xlsx:');
for (const sn of wb.SheetNames) {
  const s = wb.Sheets[sn];
  const d = XLSX.utils.sheet_to_json(s, { header: 1, defval: '' }) as unknown[][];
  let cnt = 0;
  for (let i = 3; i < d.length; i++) {
    const r = d[i] as unknown[];
    if (r && String(r[1] || '').trim()) cnt++;
  }
  console.log(`  "${sn}": ${cnt} clients, range: ${s['!ref']}`);
}
