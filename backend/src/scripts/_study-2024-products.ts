import * as XLSX from 'xlsx';
import * as path from 'path';

const FILE = path.resolve(__dirname, '../../../26.12.2024.xlsx');
const wb = XLSX.readFile(FILE);

function norm(v: any): string {
  if (v == null) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

// Study column structure for first 3 months
for (let m = 0; m < 3; m++) {
  const name = wb.SheetNames[m];
  const ws = wb.Sheets[name];
  if (!ws || !ws['!ref']) continue;
  
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const totalCols = range.e.c + 1;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SHEET: "${name}" —  ${totalCols} columns, ${rows.length} rows`);
  console.log('='.repeat(80));
  
  // Print ALL headers (rows 0, 1, 2)
  for (let r = 0; r < 3; r++) {
    const row = rows[r] || [];
    console.log(`\nRow ${r} headers:`);
    for (let c = 0; c < totalCols; c++) {
      const v = norm(row[c]);
      if (v) console.log(`  col[${c}]: "${v}"`);
    }
  }
  
  // Print first 3 data rows (rows 3-5) with all values
  console.log('\n--- DATA ROWS ---');
  for (let r = 3; r < Math.min(6, rows.length); r++) {
    const row = rows[r] || [];
    const clientName = norm(row[1]);
    if (!clientName || clientName.length < 2) continue;
    const lower = clientName.toLowerCase();
    if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого') continue;
    
    console.log(`\nRow ${r}: Client="${clientName}"`);
    for (let c = 0; c < totalCols; c++) {
      const v = row[c];
      if (v != null && v !== '' && v !== 0) {
        console.log(`  col[${c}] = ${JSON.stringify(v)}`);
      }
    }
  }
}

// Also check sheets 6 (July) and 11 (December) for layout differences
for (const m of [6, 11]) {
  if (m >= wb.SheetNames.length) continue;
  const name = wb.SheetNames[m];
  const ws = wb.Sheets[name];
  if (!ws || !ws['!ref']) continue;
  
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const totalCols = range.e.c + 1;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SHEET: "${name}" (month ${m}) — ${totalCols} columns, ${rows.length} rows`);
  console.log('='.repeat(80));
  
  for (let r = 0; r < 3; r++) {
    const row = rows[r] || [];
    console.log(`\nRow ${r} headers:`);
    for (let c = 0; c < totalCols; c++) {
      const v = norm(row[c]);
      if (v) console.log(`  col[${c}]: "${v}"`);
    }
  }
  
  // First 2 data rows
  console.log('\n--- DATA ROWS ---');
  for (let r = 3; r < Math.min(5, rows.length); r++) {
    const row = rows[r] || [];
    const clientName = norm(row[1]);
    if (!clientName || clientName.length < 2) continue;
    const lower = clientName.toLowerCase();
    if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого') continue;
    
    console.log(`\nRow ${r}: Client="${clientName}"`);
    for (let c = 0; c < totalCols; c++) {
      const v = row[c];
      if (v != null && v !== '' && v !== 0) {
        console.log(`  col[${c}] = ${JSON.stringify(v)}`);
      }
    }
  }
}
