import * as XLSX from 'xlsx';
import * as path from 'path';

const FILE = path.resolve(__dirname, '../../../26.12.2024.xlsx');
const wb = XLSX.readFile(FILE);

function norm(v: any): string {
  if (v == null) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

function normLower(v: string): string {
  return v.toLowerCase().trim().replace(/\s+/g, ' ');
}

function numVal(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// Check February (month index 1) — representative sheet with 30 columns
const ws = wb.Sheets[wb.SheetNames[1]]; // February
const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
const row1 = (rows[1] || []).map((v: any) => normLower(norm(v)));
const range = XLSX.utils.decode_range(ws['!ref']!);
const totalCols = range.e.c + 1;

// Find payment columns
let cashCol = -1, transferCol = -1;
for (let c = 0; c < totalCols; c++) {
  const h = row1[c] || '';
  if (h.includes('накд') && cashCol < 0) cashCol = c;
  else if (h.includes('пер') && !h.includes('перечисл') && transferCol < 0) transferCol = c;
}

console.log(`February sheet: ${rows.length} rows, ${totalCols} cols`);
console.log(`Cash col: ${cashCol}, Transfer col: ${transferCol}`);
console.log(`Product col: 4, Qty col: 5, Unit col: 6, Price col: 7, Amount col: 8`);

// Group rows by client
const clientRows = new Map<string, number[]>();
for (let r = 3; r < rows.length; r++) {
  const row = rows[r];
  if (!row) continue;
  const clientName = norm(row[1]);
  if (!clientName || clientName.length < 2) continue;
  const lower = clientName.toLowerCase();
  if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого') continue;
  
  const key = normLower(clientName);
  if (!clientRows.has(key)) clientRows.set(key, []);
  clientRows.get(key)!.push(r);
}

// Find clients with multiple rows
let multiRowClients = 0;
let paymentOnAllRows = 0;
let paymentOnFirstOnly = 0;
let paymentOnNone = 0;

console.log('\n=== MULTI-ROW CLIENTS (February) ===');
let shown = 0;

for (const [key, rowIndices] of clientRows) {
  if (rowIndices.length <= 1) continue;
  multiRowClients++;
  
  const paymentInfo: { row: number; cash: number; transfer: number; product: string }[] = [];
  for (const r of rowIndices) {
    const row = rows[r];
    const cashCurr = cashCol >= 0 ? numVal(row[cashCol + 1]) : 0; // current month column
    const transCurr = transferCol >= 0 ? numVal(row[transferCol + 1]) : 0;
    const product = norm(row[4]);
    paymentInfo.push({ row: r, cash: cashCurr, transfer: transCurr, product });
  }
  
  const hasPaymentOnFirst = (paymentInfo[0].cash > 0 || paymentInfo[0].transfer > 0);
  const hasPaymentOnOthers = paymentInfo.slice(1).some(p => p.cash > 0 || p.transfer > 0);
  
  if (hasPaymentOnFirst && !hasPaymentOnOthers) paymentOnFirstOnly++;
  else if (hasPaymentOnFirst && hasPaymentOnOthers) paymentOnAllRows++;
  else if (!hasPaymentOnFirst && !hasPaymentOnOthers) paymentOnNone++;
  else paymentOnFirstOnly++; // weird case
  
  if (shown < 10) {
    console.log(`\nClient: "${key}" (${rowIndices.length} rows)`);
    for (const p of paymentInfo) {
      console.log(`  row[${p.row}]: product="${p.product}" | cash(curr)=${p.cash} | transfer(curr)=${p.transfer}`);
    }
    shown++;
  }
}

console.log(`\n\n=== SUMMARY (February) ===`);
console.log(`Total clients: ${clientRows.size}`);
console.log(`Multi-row clients: ${multiRowClients}`);
console.log(`  Payment on first row only: ${paymentOnFirstOnly}`);
console.log(`  Payment on all/multiple rows: ${paymentOnAllRows}`);
console.log(`  No payments on any row: ${paymentOnNone}`);

// Also check: do single-row clients differ?
let singleWithPayment = 0;
let singleWithoutPayment = 0;
for (const [key, rowIndices] of clientRows) {
  if (rowIndices.length !== 1) continue;
  const row = rows[rowIndices[0]];
  const cashCurr = cashCol >= 0 ? numVal(row[cashCol + 1]) : 0;
  const transCurr = transferCol >= 0 ? numVal(row[transferCol + 1]) : 0;
  if (cashCurr > 0 || transCurr > 0) singleWithPayment++;
  else singleWithoutPayment++;
}
console.log(`\nSingle-row clients with payment: ${singleWithPayment}`);
console.log(`Single-row clients without payment: ${singleWithoutPayment}`);

// ALSO: check if rows with the same client have different products
console.log('\n=== PRODUCT UNIQUENESS CHECK ===');
let allUnique = 0;
let hasDuplicates = 0;
for (const [key, rowIndices] of clientRows) {
  if (rowIndices.length <= 1) continue;
  const products = rowIndices.map(r => norm(rows[r][4]));
  const uniqueProducts = new Set(products);
  if (uniqueProducts.size === products.length) allUnique++;
  else hasDuplicates++;
}
console.log(`Multi-row clients with all unique products: ${allUnique}`);
console.log(`Multi-row clients with duplicate products: ${hasDuplicates}`);
