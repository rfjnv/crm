import * as XLSX from 'xlsx';
import * as path from 'path';

const FILE = path.resolve(__dirname, '../../../26.12.2024.xlsx');
const wb = XLSX.readFile(FILE);

console.log('Sheet names:', wb.SheetNames);
console.log('Sheet count:', wb.SheetNames.length);
console.log();

for (let i = 0; i < Math.min(wb.SheetNames.length, 12); i++) {
  const name = wb.SheetNames[i];
  const ws = wb.Sheets[name];
  if (!ws || !ws['!ref']) { console.log(name, ': EMPTY'); continue; }
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`--- Sheet: "${name}" ---`);
  console.log(`  Range: ${ws['!ref']}  Cols: ${range.e.c + 1}  Rows: ${rows.length}`);

  // Print first 4 rows (headers)
  for (let r = 0; r < Math.min(4, rows.length); r++) {
    const row = rows[r];
    if (!row) continue;
    const vals = (row as any[]).map((v: any, ci: number) => `${ci}:${String(v ?? '').substring(0, 25)}`).join(' | ');
    console.log(`  Row ${r}: ${vals}`);
  }

  // Count non-empty client rows
  let clientCount = 0;
  for (let r = 2; r < rows.length; r++) {
    const v = rows[r] && rows[r][1];
    if (v && String(v).trim().length > 2) {
      const lower = String(v).toLowerCase();
      if (!lower.includes('наименование') && !lower.includes('клиент') && lower !== 'итого') clientCount++;
    }
  }
  console.log(`  Client rows: ${clientCount}`);
  console.log();
}
