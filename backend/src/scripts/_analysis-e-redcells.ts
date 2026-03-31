/**
 * Section E: Scan Excel files for red-colored cells (overdue markers).
 * XLSX library doesn't preserve cell styles from .xlsx by default,
 * so we use cellStyles option and check for red fill/font.
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const FILES = [
  { name: '29.12.2025.xlsx' },
  { name: '28.02.2026.xlsx' },
];

function isRedColor(color: any): boolean {
  if (!color) return false;
  const rgb = (color.rgb || color.argb || '').toLowerCase();
  // Common red patterns
  if (rgb.includes('ff0000') || rgb.includes('ff3333') || rgb.includes('cc0000') || rgb.includes('dd0000')) return true;
  // Excel theme reds
  if (rgb.startsWith('ff') && rgb.substring(2, 4) <= '33' && rgb.substring(4, 6) <= '33') return true;
  return false;
}

interface RedCell {
  file: string;
  sheet: string;
  row: number;
  col: string;
  value: string;
  clientName: string;
}

const redCells: RedCell[] = [];

for (const file of FILES) {
  const fpath = path.resolve(process.cwd(), '..', file.name);
  if (!fs.existsSync(fpath)) {
    console.log(`File not found: ${fpath}`);
    continue;
  }

  // Read with cellStyles to get formatting info
  const wb = XLSX.readFile(fpath, { cellStyles: true });

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.toLowerCase().trim();
    if (sn === 'лист1' || sn === 'лист2') continue;

    const ws = wb.Sheets[sheetName];
    const ref = ws['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);

    // Get data as array for client names
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    for (let r = 3; r <= range.e.r; r++) {
      const clientName = data[r] ? String(data[r][1] || '').trim() : '';
      if (!clientName) continue;

      for (let c = 0; c <= range.e.c; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellAddr];
        if (!cell) continue;

        // Check cell style for red
        let isRed = false;
        if (cell.s) {
          // Check font color
          if (cell.s.font && cell.s.font.color && isRedColor(cell.s.font.color)) isRed = true;
          // Check fill color
          if (cell.s.fill) {
            if (cell.s.fill.fgColor && isRedColor(cell.s.fill.fgColor)) isRed = true;
            if (cell.s.fill.bgColor && isRedColor(cell.s.fill.bgColor)) isRed = true;
          }
          // Check patternFill
          if (cell.s.patternFill) {
            if (cell.s.patternFill.fgColor && isRedColor(cell.s.patternFill.fgColor)) isRed = true;
          }
        }

        if (isRed) {
          redCells.push({
            file: file.name,
            sheet: sheetName,
            row: r + 1,
            col: XLSX.utils.encode_col(c),
            value: String(cell.v ?? ''),
            clientName,
          });
        }
      }
    }
  }
}

console.log(`=== SECTION E: RED CELLS IN EXCEL ===\n`);
console.log(`Found ${redCells.length} red cells total`);

// Write CSV
const reportsDir = path.resolve(process.cwd(), '..', 'reports');
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

if (redCells.length > 0) {
  const csvHeader = 'file,sheet,row,col,client,value';
  const csvRows = redCells.map(r =>
    `"${r.file}","${r.sheet}",${r.row},"${r.col}","${r.clientName}","${r.value}"`
  );
  const csvPath = path.join(reportsDir, 'excel_red_cells.csv');
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf8');
  console.log(`Written: ${csvPath}`);

  // Summary by sheet
  const bySheet = new Map<string, number>();
  for (const rc of redCells) {
    const key = `${rc.file} / ${rc.sheet}`;
    bySheet.set(key, (bySheet.get(key) || 0) + 1);
  }
  console.log('\nRed cells per sheet:');
  for (const [sheet, cnt] of bySheet) {
    console.log(`  ${sheet}: ${cnt}`);
  }

  // Unique clients with red cells
  const redClients = new Set(redCells.map(r => r.clientName.toLowerCase()));
  console.log(`\nUnique clients with red cells: ${redClients.size}`);
  for (const name of [...redClients].slice(0, 20)) {
    console.log(`  ${name}`);
  }
} else {
  console.log('\nNote: XLSX library may not preserve cell styles from .xlsx files.');
  console.log('Red cell detection requires the cellStyles option which has limited support.');

  // Alternative: Check for negative closing balances or specific patterns
  console.log('\n--- Alternative: cells with negative values (potential overdue) ---');
  for (const file of FILES) {
    const fpath = path.resolve(process.cwd(), '..', file.name);
    if (!fs.existsSync(fpath)) continue;
    const wb = XLSX.readFile(fpath);

    for (const sheetName of wb.SheetNames) {
      const sn = sheetName.toLowerCase().trim();
      if (sn === 'лист1' || sn === 'лист2') continue;

      const ws = wb.Sheets[sheetName];
      const closingCol = (() => {
        const ref = ws['!ref'];
        if (!ref) return 26;
        const range = XLSX.utils.decode_range(ref);
        return range.e.c + 1 - 2;
      })();

      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
      let negCount = 0;
      const negClients: { name: string; val: number }[] = [];

      for (let i = 3; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;
        const clientName = String(row[1] || '').trim();
        if (!clientName) continue;

        const closing = typeof row[closingCol] === 'number'
          ? row[closingCol] as number
          : parseFloat(String(row[closingCol]).replace(/\s/g, '').replace(',', '.'));

        if (!isNaN(closing) && closing < -1000) {
          negCount++;
          negClients.push({ name: clientName, val: closing });
        }
      }

      if (negCount > 0) {
        console.log(`\n${file.name} / ${sheetName}: ${negCount} clients with negative closing balance`);
        negClients.sort((a, b) => a.val - b.val);
        for (const nc of negClients.slice(0, 5)) {
          console.log(`  ${nc.name.padEnd(35)} ${nc.val.toLocaleString('ru-RU')}`);
        }
      }
    }
  }

  // Write empty CSV with explanation
  const csvPath = path.join(reportsDir, 'excel_red_cells.csv');
  fs.writeFileSync(csvPath, 'note\n"XLSX library does not preserve cell styles - red cells cannot be detected programmatically. See report for alternative analysis."', 'utf8');
  console.log(`\nWritten: ${csvPath} (with note)`);
}
