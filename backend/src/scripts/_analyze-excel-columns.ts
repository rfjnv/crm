import * as XLSX from 'xlsx';
import * as path from 'path';

// Deep analysis: trace how payment columns and balance columns relate
// Focus on: column structure per sheet, payment sub-columns, and balance formula

const EXCEL_FILES = [
  { name: '29.12.2025.xlsx', label: '2025' },
  { name: '28.02.2026.xlsx', label: '2026' },
];

function norm(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

for (const file of EXCEL_FILES) {
  const fpath = path.resolve(process.cwd(), '..', file.name);
  const wb = XLSX.readFile(fpath, { cellFormula: true });

  console.log('\n' + '='.repeat(100));
  console.log(`  FILE: ${file.name}`);
  console.log('='.repeat(100));

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.toLowerCase().trim();
    if (sn === 'лист1' || sn === 'лист2') continue;

    const ws = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

    console.log(`\n--- ${sheetName} ---`);

    // Get ALL column headers from rows 0, 1, 2
    console.log('  Column map (all cols with headers):');
    for (let c = 0; c <= Math.min(30, range.e.c); c++) {
      const h0 = ws[XLSX.utils.encode_cell({ r: 0, c })]?.v;
      const h1 = ws[XLSX.utils.encode_cell({ r: 1, c })]?.v;
      const h2 = ws[XLSX.utils.encode_cell({ r: 2, c })]?.v;
      const letter = XLSX.utils.encode_col(c);
      if (h0 || h1 || h2) {
        console.log(`    Col ${c} (${letter}): "${norm(h0)}" / "${norm(h1)}" / "${norm(h2)}"`);
      }
    }

    // Find the balance column (the one with "Ост на" in row 0)
    let balCol = -1;
    for (let c = 0; c <= range.e.c; c++) {
      const h = norm(ws[XLSX.utils.encode_cell({ r: 0, c })]?.v);
      if (h.startsWith('Ост на')) {
        balCol = c;
        break;
      }
    }

    // Find the opening balance column ("Ост-к на" in row 0)
    let openCol = -1;
    for (let c = 0; c <= range.e.c; c++) {
      const h = norm(ws[XLSX.utils.encode_cell({ r: 0, c })]?.v);
      if (h.startsWith('Ост-к на') || h.startsWith('Ост-к')) {
        openCol = c;
        break;
      }
    }

    console.log(`  Opening balance col: ${openCol} (${openCol >= 0 ? XLSX.utils.encode_col(openCol) : '?'})`);
    console.log(`  Closing balance col: ${balCol} (${balCol >= 0 ? XLSX.utils.encode_col(balCol) : '?'})`);

    // Get formula from first data row
    if (balCol >= 0) {
      const formulaCell = ws[XLSX.utils.encode_cell({ r: 3, c: balCol })];
      console.log(`  Balance formula (row 3): ${formulaCell?.f || 'NO FORMULA'}`);
      console.log(`  Balance value (row 3): ${formulaCell?.v}`);
    }

    // Trace one client across rows to understand accumulation
    // Find how many rows "эгамберди" has and show all values
    let clientRows = 0;
    let lastBalance = 0;
    console.log('\n  Sample client "эгамберди" - all rows:');
    for (let r = 3; r <= range.e.r && clientRows < 10; r++) {
      const name = norm(ws[XLSX.utils.encode_cell({ r, c: 1 })]?.v).toLowerCase();
      if (name === 'эгамберди') {
        clientRows++;
        const openBal = numVal(ws[XLSX.utils.encode_cell({ r, c: openCol })]?.v);
        const goods = numVal(ws[XLSX.utils.encode_cell({ r, c: 8 })]?.v); // col I - сумма
        // Payment columns - get all
        const payL = numVal(ws[XLSX.utils.encode_cell({ r, c: 11 })]?.v);
        const payO = numVal(ws[XLSX.utils.encode_cell({ r, c: 14 })]?.v);
        const payR = numVal(ws[XLSX.utils.encode_cell({ r, c: 17 })]?.v);
        const payU = numVal(ws[XLSX.utils.encode_cell({ r, c: 20 })]?.v);
        const payX = numVal(ws[XLSX.utils.encode_cell({ r, c: 23 })]?.v);

        // For feb 2026 - shifted columns
        const payM = numVal(ws[XLSX.utils.encode_cell({ r, c: 12 })]?.v);
        const payP = numVal(ws[XLSX.utils.encode_cell({ r, c: 15 })]?.v);
        const payS = numVal(ws[XLSX.utils.encode_cell({ r, c: 18 })]?.v);
        const payV = numVal(ws[XLSX.utils.encode_cell({ r, c: 21 })]?.v);
        const payY = numVal(ws[XLSX.utils.encode_cell({ r, c: 24 })]?.v);

        const closeBal = numVal(ws[XLSX.utils.encode_cell({ r, c: balCol })]?.v);
        const formula = ws[XLSX.utils.encode_cell({ r, c: balCol })]?.f || '';

        console.log(`    Row ${r}: open=${openBal} goods=${goods} payL=${payL} payO=${payO} payR=${payR} payU=${payU} payX=${payX} => close=${closeBal} (f=${formula})`);
        lastBalance = closeBal;
      }
    }

    // Also check a client with actual payments
    console.log('\n  Finding a client with payments > 0...');
    for (let r = 3; r <= Math.min(range.e.r, 200); r++) {
      const payL = numVal(ws[XLSX.utils.encode_cell({ r, c: 11 })]?.v);
      if (payL > 0) {
        const name = norm(ws[XLSX.utils.encode_cell({ r, c: 1 })]?.v);
        const openBal = numVal(ws[XLSX.utils.encode_cell({ r, c: openCol })]?.v);
        const goods = numVal(ws[XLSX.utils.encode_cell({ r, c: 8 })]?.v);
        const payO = numVal(ws[XLSX.utils.encode_cell({ r, c: 14 })]?.v);
        const payR = numVal(ws[XLSX.utils.encode_cell({ r, c: 17 })]?.v);
        const payU = numVal(ws[XLSX.utils.encode_cell({ r, c: 20 })]?.v);
        const payX = numVal(ws[XLSX.utils.encode_cell({ r, c: 23 })]?.v);
        const closeBal = numVal(ws[XLSX.utils.encode_cell({ r, c: balCol })]?.v);
        const formula = ws[XLSX.utils.encode_cell({ r, c: balCol })]?.f || '';

        const recalc = openBal + goods - payL - payO - payU - payX - payR;

        console.log(`    Row ${r}: "${name}" open=${openBal} goods=${goods} payL=${payL} payO=${payO} payR=${payR} payU=${payU} payX=${payX} => close=${closeBal} (recalc=${recalc}) f=${formula}`);

        // Show 2 more rows after
        for (let r2 = r + 1; r2 <= Math.min(r + 3, range.e.r); r2++) {
          const name2 = norm(ws[XLSX.utils.encode_cell({ r: r2, c: 1 })]?.v);
          if (!name2) continue;
          const ob2 = numVal(ws[XLSX.utils.encode_cell({ r: r2, c: openCol })]?.v);
          const g2 = numVal(ws[XLSX.utils.encode_cell({ r: r2, c: 8 })]?.v);
          const l2 = numVal(ws[XLSX.utils.encode_cell({ r: r2, c: 11 })]?.v);
          const o2 = numVal(ws[XLSX.utils.encode_cell({ r: r2, c: 14 })]?.v);
          const r2v = numVal(ws[XLSX.utils.encode_cell({ r: r2, c: 17 })]?.v);
          const u2 = numVal(ws[XLSX.utils.encode_cell({ r: r2, c: 20 })]?.v);
          const x2 = numVal(ws[XLSX.utils.encode_cell({ r: r2, c: 23 })]?.v);
          const cb2 = numVal(ws[XLSX.utils.encode_cell({ r: r2, c: balCol })]?.v);
          const f2 = ws[XLSX.utils.encode_cell({ r: r2, c: balCol })]?.f || '';
          console.log(`    Row ${r2}: "${name2}" open=${ob2} goods=${g2} payL=${l2} payO=${o2} payR=${r2v} payU=${u2} payX=${x2} => close=${cb2} f=${f2}`);
        }
        break;
      }
    }

    // Only first 3 sheets and last sheet for 2025
    if (file.label === '2025' && wb.SheetNames.indexOf(sheetName) >= 3) {
      const lastIdx = wb.SheetNames.length - 3; // декабрь 2025
      if (wb.SheetNames.indexOf(sheetName) < lastIdx) {
        continue;
      }
    }
  }
}
