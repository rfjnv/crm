import * as XLSX from 'xlsx';
import path from 'path';

function norm(s: any) { return s == null ? '' : String(s).trim().replace(/\s+/g, ' '); }
function normLower(s: any) { return norm(s).toLowerCase(); }
function numVal(v: any) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

const file = path.join(__dirname, 'data', 'analytics_2024-12-26.xlsx');
const wb = XLSX.readFile(file);
const sheet = wb.Sheets[wb.SheetNames[0]];

const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, range: 3 });

const ref = sheet['!ref'];
const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
const closingBalanceCol = totalCols - 2;

console.log('--- VECTOR PRINT ROWS ---');
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const clientName = normLower(row[1]);
  if (clientName === 'вектор принт') {
    const opType = norm(row[9]);
    const cb = numVal(row[closingBalanceCol]);
    const qty = numVal(row[5]);
    const price = numVal(row[7]);
    const rev = numVal(row[8]);
    
    const pStart = totalCols - 17;
    const L = numVal(row[pStart]);    
    const O = numVal(row[pStart + 3]);
    const R = numVal(row[pStart + 6]); 
    const U = numVal(row[pStart + 9]); 
    const X = numVal(row[pStart + 12]);
    const totalPayments = L + O + R + U + X;

    console.log(`ROW ${i+4}: Date=${row[0]}, Qty=${qty}, Price=${price}, Rev=${rev}, Op=${opType}, CLB(AA)=${cb}, Payments=${totalPayments}`);
  }
}
