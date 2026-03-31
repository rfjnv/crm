/**
 * Search for nosir kredo in 29.12.2025.xlsx
 * READ-ONLY - no data modifications
 */
import * as XLSX from 'xlsx';
import * as path from 'path';

const filePath = path.resolve(__dirname, '..', '..', '..', '29.12.2025.xlsx');
console.log('=' .repeat(80));
console.log('FILE:', filePath);
console.log('='.repeat(80));

const wb = XLSX.readFile(filePath, { cellDates: true });

console.log(''); 
console.log('-- 1. ALL SHEET NAMES --');
console.log('');
wb.SheetNames.forEach((name: string, i: number) => {
  console.log('  [' + i + '] ' + name);
});

console.log('');
console.log('-- 2. OCTOBER RELATED SHEETS --');
console.log('');
const octoberSheets = wb.SheetNames.filter((name: string) => {
  const lower = name.toLowerCase();
  return lower.includes('октябр') || lower.includes('october');
});

if (octoberSheets.length === 0) {
  console.log('  No sheets with october in name found.');
} else {
  octoberSheets.forEach((name: string) => console.log('  -> ' + name));
}

console.log('');
console.log('-- 3. SEARCHING ALL SHEETS FOR kredo / nosir --');
console.log('');

const searchTerms = ['кредо', 'носир'];
let totalMatches = 0;

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref'];
  if (!ref) continue;
  const range = XLSX.utils.decode_range(ref);
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(cell ? String(cell.v) : 'Col_' + XLSX.utils.encode_col(c));
  }
  for (let r = range.s.r; r <= range.e.r; r++) {
    let rowText = '';
    const rowData: Record<string, any> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const headerKey = headers[c - range.s.c] || 'Col_' + c;
        rowData[headerKey] = cell.v;
        rowText += ' ' + String(cell.v).toLowerCase();
      }
    }
    const matchesAny = searchTerms.some(term => rowText.includes(term));
    if (matchesAny) {
      totalMatches++;
      console.log('  -- MATCH in sheet "' + sheetName + '", row ' + (r + 1) + ' --');
      for (const [key, val] of Object.entries(rowData)) {
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          console.log('    ' + key + ': ' + val);
        }
      }
      const amounts = Object.values(rowData).filter((v: any) => typeof v === 'number');
      const has69m = amounts.some((a: any) => Math.abs(a - 69420000) < 1);
      if (has69m) {
        console.log('    >>> FOUND AMOUNT 69,420,000 <<<');
      }
      console.log('');
    }
  }
}

if (totalMatches === 0) {
  console.log('  No matching rows found.');
} else {
  console.log('  Total matching rows: ' + totalMatches);
}

console.log('');
console.log('-- 4. SEARCHING ALL SHEETS FOR AMOUNT 69,420,000 --');
console.log('');
let amountMatches = 0;

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref'];
  if (!ref) continue;
  const range = XLSX.utils.decode_range(ref);
  const hdrs: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    hdrs.push(cell ? String(cell.v) : 'Col_' + XLSX.utils.encode_col(c));
  }
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowData: Record<string, any> = {};
    let found69m = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const headerKey = hdrs[c - range.s.c] || 'Col_' + c;
        rowData[headerKey] = cell.v;
        if (typeof cell.v === 'number' && Math.abs(cell.v - 69420000) < 1) {
          found69m = true;
        }
      }
    }
    if (found69m) {
      amountMatches++;
      console.log('  -- AMOUNT MATCH in sheet "' + sheetName + '", row ' + (r + 1) + ' --');
      for (const [key, val] of Object.entries(rowData)) {
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          console.log('    ' + key + ': ' + val);
        }
      }
      console.log('');
    }
  }
}

if (amountMatches === 0) {
  console.log('  No rows with amount 69,420,000 found.');
} else {
  console.log('  Total rows with amount 69,420,000: ' + amountMatches);
}

console.log('');
console.log('='.repeat(80));
console.log('SEARCH COMPLETE');
console.log('='.repeat(80));