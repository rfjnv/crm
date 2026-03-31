import * as XLSX from 'xlsx';
import * as path from 'path';

// Analyze Excel files deeply - headers, formulas, column structure

const EXCEL_FILES = [
  { name: '29.12.2025.xlsx', label: '2025' },
  { name: '28.02.2026.xlsx', label: '2026' },
];

function norm(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

for (const file of EXCEL_FILES) {
  const fpath = path.resolve(process.cwd(), '..', file.name);
  const wb = XLSX.readFile(fpath, { cellFormula: true, cellStyles: true });

  console.log('\n' + '='.repeat(100));
  console.log(`  FILE: ${file.name} (${wb.SheetNames.length} sheets)`);
  console.log('='.repeat(100));
  console.log('Sheets:', wb.SheetNames.join(', '));

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.toLowerCase().trim();
    if (sn === 'лист1' || sn === 'лист2') continue;

    const ws = wb.Sheets[sheetName];

    console.log('\n' + '-'.repeat(80));
    console.log(`  SHEET: "${sheetName}"`);
    console.log('-'.repeat(80));

    // Get range
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    console.log(`  Range: ${ws['!ref']} (rows: ${range.e.r + 1}, cols: ${range.e.c + 1})`);

    // Print header rows (rows 0-3) with column indices
    console.log('\n  HEADERS (rows 0-3):');
    for (let r = 0; r <= Math.min(3, range.e.r); r++) {
      const cells: string[] = [];
      for (let c = 0; c <= Math.min(30, range.e.c); c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell) {
          const val = norm(cell.v);
          if (val) {
            const colLetter = XLSX.utils.encode_col(c);
            cells.push(`[${c}/${colLetter}]="${val}"`);
          }
        }
      }
      if (cells.length > 0) {
        console.log(`    Row ${r}: ${cells.join('  ')}`);
      }
    }

    // Focus on columns 24-30 (around AA) - check formulas
    console.log('\n  COLUMNS 24-30 DETAIL (first 8 data rows):');
    for (let r = 0; r <= Math.min(10, range.e.r); r++) {
      const cells: string[] = [];
      for (let c = 24; c <= Math.min(30, range.e.c); c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const colLetter = XLSX.utils.encode_col(c);
        if (cell) {
          let info = `[${colLetter}]v=${JSON.stringify(cell.v)}`;
          if (cell.f) info += ` f="${cell.f}"`;
          if (cell.t) info += ` t=${cell.t}`;
          cells.push(info);
        }
      }
      if (cells.length > 0) {
        console.log(`    Row ${r}: ${cells.join('  |  ')}`);
      }
    }

    // Check column 27 (AA) specifically - values and formulas for rows 3-10
    console.log('\n  COLUMN 27 (AB / index 27) - VALUES & FORMULAS:');
    for (let r = 0; r <= Math.min(15, range.e.r); r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 27 });
      const cell = ws[addr];
      if (cell) {
        let info = `  Row ${r}: value=${JSON.stringify(cell.v)}, type=${cell.t}`;
        if (cell.f) info += `, FORMULA="${cell.f}"`;
        if (cell.w) info += `, formatted="${cell.w}"`;
        console.log(info);
      }
    }

    // Also check columns around it
    console.log('\n  COLUMN HEADERS at row 1-2 (cols 20-30):');
    for (let r = 0; r <= 2; r++) {
      const cells: string[] = [];
      for (let c = 20; c <= Math.min(30, range.e.c); c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const colLetter = XLSX.utils.encode_col(c);
        if (cell && cell.v != null) {
          cells.push(`${colLetter}(${c})="${norm(cell.v)}"`);
        }
      }
      if (cells.length > 0) {
        console.log(`    Row ${r}: ${cells.join('  ')}`);
      }
    }

    // Sample 3 client rows (rows 3-5) - ALL columns
    console.log('\n  FULL ROW SAMPLE (rows 3-5):');
    for (let r = 3; r <= Math.min(5, range.e.r); r++) {
      console.log(`\n    === Row ${r} ===`);
      for (let c = 0; c <= Math.min(30, range.e.c); c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const colLetter = XLSX.utils.encode_col(c);
        if (cell && cell.v != null && String(cell.v).trim()) {
          let info = `      Col ${c} (${colLetter}): value=${JSON.stringify(cell.v)}`;
          if (cell.f) info += `  FORMULA="${cell.f}"`;
          if (cell.t === 'n' && cell.w) info += `  display="${cell.w}"`;
          console.log(info);
        }
      }
    }

    // Only analyze first 2 sheets in detail
    if (wb.SheetNames.indexOf(sheetName) >= 2 && file.label === '2025') {
      console.log('\n  [Skipping remaining 2025 sheets for brevity - checking last sheet]');
      // Jump to last sheet
      if (sheetName !== wb.SheetNames[wb.SheetNames.length - 1] &&
          sheetName !== wb.SheetNames[wb.SheetNames.length - 2]) {
        continue;
      }
    }
  }
}
