/**
 * Dump Feb 2026 headers and sample rows to verify closing column
 */
import * as XLSX from 'xlsx';
import path from 'path';

const fpath = path.resolve(process.cwd(), '..', '28.02.2026.xlsx');
const wb = XLSX.readFile(fpath);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  console.log(`\n=== Sheet: ${sheetName} ===`);
  for (let r = 0; r < 3; r++) {
    const row = data[r] as unknown[];
    if (!row) continue;
    const cells = row.map((c, j) => `[${j}]="${c}"`).filter(s => !s.endsWith('=""'));
    console.log(`  Row ${r}: ${cells.join('  ')}`);
  }

  // Show 5 sample data rows with closing balance
  console.log(`  --- Sample data rows ---`);
  let shown = 0;
  for (let i = 3; i < data.length && shown < 5; i++) {
    const row = data[i] as unknown[];
    if (!row) continue;
    const client = String(row[1] || '').trim();
    if (!client) continue;
    const cells = row.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('='));
    console.log(`  Row ${i}: ${cells.join(' | ')}`);
    shown++;
  }

  // Find the LAST row per client and sum closing balances from different columns
  const lastRowPerClient = new Map<string, unknown[]>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row) continue;
    const client = String(row[1] || '').trim().toLowerCase();
    if (!client) continue;
    lastRowPerClient.set(client, row);
  }

  // Try closing from col 26, 27, 28
  for (const col of [26, 27, 28]) {
    let sum = 0;
    let nonZero = 0;
    for (const [, row] of lastRowPerClient) {
      const val = Number(row[col]) || 0;
      if (val !== 0) nonZero++;
      sum += val;
    }
    console.log(`  Closing col[${col}]: sum=${sum.toLocaleString()}, nonZero=${nonZero}/${lastRowPerClient.size}`);
  }

  // Also try summing ALL rows' closing for comparison
  for (const col of [26, 27, 28]) {
    let sum = 0;
    for (let i = 3; i < data.length; i++) {
      const row = data[i] as unknown[];
      if (!row) continue;
      if (!String(row[1] || '').trim()) continue;
      sum += Number(row[col]) || 0;
    }
    console.log(`  ALL rows col[${col}] sum=${sum.toLocaleString()}`);
  }
}
