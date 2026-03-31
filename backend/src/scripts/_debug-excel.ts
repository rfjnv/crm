import * as XLSX from 'xlsx';
import path from 'path';

// Analyze payment columns structure across all months
const files = [
  { name: '29.12.2025.xlsx', label: '2025' },
  { name: '28.02.2026.xlsx', label: '2026' },
];

for (const file of files) {
  const fpath = path.resolve(process.cwd(), '..', file.name);
  const wb = XLSX.readFile(fpath);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`FILE: ${file.name} (${wb.SheetNames.length} sheets)`);

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Лист1' || sheetName === 'Лист2') continue;
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    const h0 = data[0] as unknown[];
    const h1 = data[1] as unknown[];
    const h2 = data[2] as unknown[];

    // Find closing balance column index
    let closingCol = -1;
    for (let j = (h0?.length || 0) - 1; j >= 0; j--) {
      if (String(h0?.[j] || '').toLowerCase().startsWith('ост')) {
        closingCol = j;
        break;
      }
    }

    console.log(`\n--- ${sheetName} (closingCol=${closingCol}) ---`);
    console.log(`  Headers row 0: ${h0?.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('=')).join(' | ')}`);
    console.log(`  Headers row 1: ${h1?.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('=')).join(' | ')}`);
    console.log(`  Headers row 2: ${h2?.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('=')).join(' | ')}`);

    // Find actual data rows count
    let dataRows = 0;
    for (let i = 3; i < Math.min(data.length, 2000); i++) {
      const row = data[i] as unknown[];
      if (!row || !String(row[1] || '').trim()) continue;
      dataRows++;
    }

    // Sample a few rows with payments to understand structure
    let paymentExamples = 0;
    for (let i = 3; i < Math.min(data.length, 2000) && paymentExamples < 3; i++) {
      const row = data[i] as unknown[];
      if (!row) continue;
      // Check if any payment column (11-25) has a value
      let hasPayment = false;
      for (let j = 11; j <= 25; j++) {
        if (Number(row[j]) > 0) { hasPayment = true; break; }
      }
      if (hasPayment) {
        paymentExamples++;
        const cells = row.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('='));
        console.log(`  Payment example row ${i}: ${cells.join(' | ')}`);
      }
    }

    // Sum all payments by type
    let totalCash = 0, totalTransfer = 0, totalQR = 0, totalClick = 0, totalTerminal = 0;
    let totalAllPayments = 0;
    let rowsWithPayment = 0;

    for (let i = 3; i < Math.min(data.length, 2000); i++) {
      const row = data[i] as unknown[];
      if (!row) continue;

      // Payment columns depend on the sheet structure
      // From the headers: [11]=накд(cash), [14]=пер(transfer), [17]=QR CODE, [20]=клик, [23]=терминал
      // Sub-columns: всего, month-name, (maybe running total)
      // The "всего" (total) sub-column is what we want

      const cash = Number(row[11]) || 0;
      const transfer = Number(row[14]) || 0;
      const qr = Number(row[17]) || 0;
      const click = Number(row[20]) || 0;
      const terminal = Number(row[23]) || 0;
      const total = cash + transfer + qr + click + terminal;

      if (total > 0) {
        rowsWithPayment++;
        totalCash += cash;
        totalTransfer += transfer;
        totalQR += qr;
        totalClick += click;
        totalTerminal += terminal;
        totalAllPayments += total;
      }
    }

    console.log(`  Data rows: ${dataRows}, With payments: ${rowsWithPayment}`);
    console.log(`  Payment totals: cash=${totalCash.toLocaleString()} transfer=${totalTransfer.toLocaleString()} QR=${totalQR.toLocaleString()} click=${totalClick.toLocaleString()} terminal=${totalTerminal.toLocaleString()}`);
    console.log(`  TOTAL payments: ${totalAllPayments.toLocaleString()}`);
  }
}
