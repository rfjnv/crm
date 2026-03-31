/**
 * Quick check: are these the same Excel files or updated ones?
 * Compare structure, row counts, and closing balance totals.
 */
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const FILES = [
  { name: '29.12.2025.xlsx', defaultYear: 2025 },
  { name: '28.02.2026.xlsx', defaultYear: 2026 },
];

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function getClosingCol(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref'];
  if (!ref) return 26;
  const range = XLSX.utils.decode_range(ref);
  return range.e.c - 1; // 2nd-to-last column
}

for (const file of FILES) {
  const fpath = path.resolve(process.cwd(), '..', file.name);
  const stat = fs.statSync(fpath);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FILE: ${file.name}`);
  console.log(`  Size: ${(stat.size / 1024).toFixed(0)} KB`);
  console.log(`  Modified: ${stat.mtime.toISOString()}`);

  const wb = XLSX.readFile(fpath);
  console.log(`  Sheets: ${wb.SheetNames.length} → [${wb.SheetNames.join(', ')}]`);

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.toLowerCase().trim();
    if (sn === 'лист1' || sn === 'лист2') {
      console.log(`  ${sheetName}: (skip - auxiliary)`);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    const ref = ws['!ref'] || '';
    const range = ref ? XLSX.utils.decode_range(ref) : null;
    const totalCols = range ? range.e.c + 1 : 0;
    const totalRows = range ? range.e.r + 1 : 0;
    const closingCol = getClosingCol(ws);

    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    // Read header row 0
    const header0 = data[0] as unknown[];
    const header1 = data[1] as unknown[];
    const header2 = data[2] as unknown[];

    // Get col C header (opening), closing col header
    const openingHeader = header0 ? String(header0[2] || '').trim() : '?';
    const closingHeader = header0 ? String(header0[closingCol] || '').trim() : '?';

    // Sum closing balance
    let closingSum = 0;
    let clientSet = new Set<string>();
    let dataRows = 0;
    for (let i = 3; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const clientName = String(row[1] || '').trim().toLowerCase();
      if (!clientName) continue;
      dataRows++;
      clientSet.add(clientName);
      closingSum += numVal(row[closingCol]);
    }

    // Check a few column headers from row 0
    const colHeaders: string[] = [];
    if (header0) {
      for (let c = 0; c < Math.min(totalCols, 30); c++) {
        const v = String(header0[c] || '').trim();
        if (v) colHeaders.push(`[${c}]=${v}`);
      }
    }

    console.log(`  ${sheetName}:`);
    console.log(`    Range: ${ref} (${totalRows} rows, ${totalCols} cols)`);
    console.log(`    Data rows: ${dataRows}, Unique clients: ${clientSet.size}`);
    console.log(`    closingCol=${closingCol}, Opening: "${openingHeader}", Closing: "${closingHeader}"`);
    console.log(`    Closing balance sum: ${closingSum.toLocaleString('ru-RU')}`);
    console.log(`    Headers: ${colHeaders.join('  ')}`);
  }
}
