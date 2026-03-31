import * as XLSX from 'xlsx';
import * as path from 'path';

const filePath = path.resolve(__dirname, '..', '..', '..', '03.03.2026.xlsx');
console.log('=== Reading file:', filePath);
console.log();

const wb = XLSX.readFile(filePath, { cellDates: true });

console.log('=== 1. SHEETS ===');
console.log('Sheet names:', wb.SheetNames);
console.log('Total sheets:', wb.SheetNames.length);
console.log();

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref'];
  console.log('========================================');
  console.log('SHEET:', sheetName);
  console.log('Range:', ref);

  if (!ref) { console.log('(empty sheet)'); continue; }

  const range = XLSX.utils.decode_range(ref);
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;
  console.log('Dimensions: rows=' + totalRows + ', cols=' + totalCols);
  console.log('Column range: ' + XLSX.utils.encode_col(range.s.c) + ' to ' + XLSX.utils.encode_col(range.e.c));
  console.log();

  // Column headers - first 5 rows
  console.log('--- FIRST 5 ROWS (raw) ---');
  for (let r = range.s.r; r <= Math.min(range.s.r + 4, range.e.r); r++) {
    const rowData: Record<string, any> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell) {
        const colLetter = XLSX.utils.encode_col(c);
        rowData[colLetter] = { v: cell.v, t: cell.t, w: cell.w || '' };
      }
    }
    console.log('Row ' + (r + 1) + ':', JSON.stringify(rowData));
  }
  console.log();

  // Columns AA, AB, AC
  console.log('--- COLUMNS Z, AA, AB, AC (first 10 data rows) ---');
  for (let r = range.s.r; r <= Math.min(range.s.r + 9, range.e.r); r++) {
    const zCell = ws[XLSX.utils.encode_cell({ r, c: 25 })];
    const aaCell = ws[XLSX.utils.encode_cell({ r, c: 26 })];
    const abCell = ws[XLSX.utils.encode_cell({ r, c: 27 })];
    const acCell = ws[XLSX.utils.encode_cell({ r, c: 28 })];
    console.log('Row ' + (r + 1)
      + ': Z=' + (zCell ? JSON.stringify({ v: zCell.v, t: zCell.t, w: zCell.w }) : 'empty')
      + ' | AA=' + (aaCell ? JSON.stringify({ v: aaCell.v, t: aaCell.t, w: aaCell.w }) : 'empty')
      + ' | AB=' + (abCell ? JSON.stringify({ v: abCell.v, t: abCell.t, w: abCell.w }) : 'empty')
      + ' | AC=' + (acCell ? JSON.stringify({ v: acCell.v, t: acCell.t, w: acCell.w }) : 'empty'));
  }
  console.log();

  // Date format analysis
  console.log('--- DATE FORMAT ANALYSIS ---');
  const dateExamples: any[] = [];
  for (let r = range.s.r; r <= Math.min(range.s.r + 30, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'd') {
        dateExamples.push({
          addr: XLSX.utils.encode_cell({ r, c }),
          v: cell.v,
          t: cell.t,
          w: cell.w,
          z: (cell as any).z
        });
      } else if (cell && cell.t === 'n' && cell.w && /\d{2}[\.\/\-]\d{2}[\.\/\-]\d{2,4}/.test(cell.w || '')) {
        dateExamples.push({
          addr: XLSX.utils.encode_cell({ r, c }),
          v: cell.v,
          t: cell.t,
          w: cell.w,
          z: (cell as any).z,
          note: 'number-formatted-as-date'
        });
      }
    }
  }
  console.log('Date examples found:', dateExamples.length);
  dateExamples.slice(0, 15).forEach(d => console.log('  ', JSON.stringify(d)));
  console.log();

  // Row count
  console.log('--- ROW COUNT ---');
  let nonEmptyRows = 0;
  for (let r = range.s.r; r <= range.e.r; r++) {
    let hasData = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (ws[XLSX.utils.encode_cell({ r, c })]) { hasData = true; break; }
    }
    if (hasData) nonEmptyRows++;
  }
  console.log('Total rows in range: ' + totalRows);
  console.log('Non-empty rows: ' + nonEmptyRows);
  console.log();

  // Last 5 rows
  console.log('--- LAST 5 ROWS ---');
  for (let r = Math.max(range.e.r - 4, range.s.r); r <= range.e.r; r++) {
    const rowData: Record<string, any> = {};
    for (let c = range.s.c; c <= Math.min(range.e.c, 10); c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell) {
        const colLetter = XLSX.utils.encode_col(c);
        rowData[colLetter] = { v: cell.v, t: cell.t, w: cell.w || '' };
      }
    }
    console.log('Row ' + (r + 1) + ':', JSON.stringify(rowData));
  }
  console.log();

  // Search for March 2026
  console.log('--- SEARCH FOR MARCH 2026 INDICATORS ---');
  const marchFound: any[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const val = String(cell.v || '').toLowerCase();
        const wval = String(cell.w || '').toLowerCase();
        if (val.includes('mart') || val.includes('march') || val.includes('03.2026') || val.includes('3.2026') ||
          wval.includes('mart') || wval.includes('march') || wval.includes('03.2026') || wval.includes('3.2026') ||
          val.includes('март') || val.includes('mar')) {
          marchFound.push({ addr: XLSX.utils.encode_cell({ r, c }), v: cell.v, w: cell.w });
        }
        if (cell.t === 'd' && cell.v instanceof Date && cell.v.getMonth() === 2 && cell.v.getFullYear() === 2026) {
          marchFound.push({ addr: XLSX.utils.encode_cell({ r, c }), v: cell.v, w: cell.w, note: 'date-march-2026' });
        }
      }
    }
  }
  console.log('March 2026 references found:', marchFound.length);
  marchFound.slice(0, 20).forEach(m => console.log('  ', JSON.stringify(m)));
  if (marchFound.length > 20) console.log('  ... and ' + (marchFound.length - 20) + ' more');
  console.log();
}

// Merged cells
console.log('=== MERGED CELLS ===');
for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  if (ws['!merges'] && ws['!merges'].length > 0) {
    console.log(sheetName + ': ' + ws['!merges'].length + ' merged ranges');
    ws['!merges'].slice(0, 5).forEach((m: any) => {
      console.log('  ', XLSX.utils.encode_range(m));
    });
  } else {
    console.log(sheetName + ': no merges');
  }
}

// Column headers summary
console.log();
console.log('=== COLUMN HEADER SUMMARY ===');
for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref'];
  if (!ref) continue;
  const range = XLSX.utils.decode_range(ref);
  console.log('SHEET:', sheetName);
  // Try rows 0, 1, 2 as potential header rows
  for (let headerRow = 0; headerRow <= 2; headerRow++) {
    const headers: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
      const colLetter = XLSX.utils.encode_col(c);
      headers.push(colLetter + '=' + (cell ? String(cell.v) : ''));
    }
    console.log('  Row ' + (headerRow + 1) + ' headers: ' + headers.join(' | '));
  }
  console.log();
}
