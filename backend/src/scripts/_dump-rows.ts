/**
 * Dump raw data for a sample client to understand column meanings
 */
import * as XLSX from 'xlsx';
import path from 'path';

const fpath = path.resolve(process.cwd(), '..', '29.12.2025.xlsx');
const wb = XLSX.readFile(fpath);

// January 2025 sheet
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

// Show headers
console.log('=== HEADERS ===');
for (let r = 0; r < 3; r++) {
  const row = data[r] as unknown[];
  if (!row) continue;
  const cells = row.map((c, j) => `[${j}]="${c}"`).filter(s => !s.endsWith('=""'));
  console.log(`  Row ${r}: ${cells.join('  ')}`);
}

// Find "стар полиграф" rows
const target = 'стар полиграф';
console.log(`\n=== All rows for "${target}" in January 2025 ===`);
for (let i = 3; i < data.length; i++) {
  const row = data[i] as unknown[];
  if (!row) continue;
  const client = String(row[1] || '').trim().toLowerCase();
  if (client !== target) continue;

  // Show ALL cells with content
  const cells = row.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('='));
  console.log(`  Row ${i}: ${cells.join(' | ')}`);
}

// Also check another client with small number of rows
console.log(`\n=== First 10 data rows (any client) ===`);
for (let i = 3; i < Math.min(data.length, 13); i++) {
  const row = data[i] as unknown[];
  if (!row) continue;
  const cells = row.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('='));
  console.log(`  Row ${i}: ${cells.join(' | ')}`);
}
