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

let sumGiven = 0; // К, Н/К, П/К, Ф
let sumOwed = 0;  // К, Н/К, П/К, Ф, ПП

const mapping: any = {
  'к': 'K', 'н': 'N', 'н/к': 'NK', 'п': 'P', 'п/к': 'PK',
  'пп': 'PP', 'обмен': 'EXCHANGE', 'ф': 'F',
};

for (const row of rows) {
  const clientName = norm(row[1]); // COL_CLIENT
  if (!clientName) continue;
  
  const opTypeRaw = normLower(row[9]); // COL_OP_TYPE
  const balanceRaw = row[closingBalanceCol];
  const balance = numVal(balanceRaw);
  
  const mapped = mapping[opTypeRaw] ?? 'UNKNOWN';

  if (['K','NK','PK','F'].includes(mapped)) {
      sumGiven += balance;
      sumOwed += balance;
  } else if (mapped === 'PP') {
      sumOwed += balance;
  }
}

console.log('');
console.log('--- ИТОГИ СЛОЖЕНИЯ ВСЕХ СТРОК (Лист 1: Январь 2024) ---');
console.log('Сумма (К, Н/К, П/К, Ф) [Без ПП]:', sumGiven);
console.log('Сумма (К, Н/К, П/К, Ф, ПП) [С ПП]:', sumOwed);
console.log('--- Ожидания пользователя ---');
console.log('Без ПП: 1 212 601 816');
console.log('С ПП:   1 170 743 266');
