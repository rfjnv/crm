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

const clientNets = new Map<string, number>();

for (const row of rows) {
  const clientName = norm(row[1]);
  if (!clientName) continue;
  
  if (!clientNets.has(clientName)) {
      clientNets.set(clientName, numVal(row[2])); // start from Col C
  }
}

// Now add all debts and subtract all payments
const mapping: any = {
  'к': 'K', 'н': 'N', 'н/к': 'NK', 'п': 'P', 'п/к': 'PK',
  'пп': 'PP', 'обмен': 'EXCHANGE', 'ф': 'F',
};

for (const row of rows) {
  const clientName = norm(row[1]);
  if (!clientName) continue;
  
  let rowAmount = 0;
  const opType = mapping[normLower(row[9])] ?? 'UNKNOWN';
  
  if (['K','NK','PK','F'].includes(opType)) {
     // For debt rows, debt increment is exactly AA (closing balance)
     // BUT wait! Does AA represent the accumulated debt or just the transaction's debt?
     // As proved earlier, AA for 'k' is just the transaction amount!
     const aa = numVal(row[closingBalanceCol]);
     rowAmount += aa; 
  } else if (opType === 'P' || opType === 'PP') {
      const pStart = totalCols - 17;
      const L = numVal(row[pStart]);    
      const O = numVal(row[pStart + 3]);
      const R = numVal(row[pStart + 6]); 
      const U = numVal(row[pStart + 9]); 
      const X = numVal(row[pStart + 12]);
      const payments = L + O + R + U + X;
      rowAmount -= payments;
  }
  
  clientNets.set(clientName, clientNets.get(clientName)! + rowAmount);
}

let totalNetWithoutPP = 0;
let totalNetWithPP = 0;
let combinedOwed = 0;
let combinedPrepayments = 0;

for (const net of clientNets.values()) {
    if (net > 0) combinedOwed += net;
    else if (net < 0) combinedPrepayments += Math.abs(net);
}
console.log(`Global Owed (Net Positives): ${combinedOwed}`);
console.log(`Global Prepayments (Net Negatives): ${combinedPrepayments}`);
console.log(`Global Absolute Net: ${combinedOwed - combinedPrepayments}`);
