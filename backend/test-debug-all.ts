import * as XLSX from 'xlsx';
import path from 'path';

function norm(s: any) { return s == null ? '' : String(s).trim().replace(/\s+/g, ' '); }
function normLower(s: any) { return norm(s).toLowerCase(); }
function numVal(v: any) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y >= 1900 && d.y <= 2100) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }
  return null;
}

const MONTH_NAMES = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const file = path.join(__dirname, 'data', 'analytics_2024-12-26.xlsx');
const wb = XLSX.readFile(file);

// Trace these mismatched clients
const targets = [
  'тимур дилшод', 'офсет принт', 'сабр принт', // massive negative
  'мега папер',  // CRM 41.2M vs Excel 36M
  'ахмад ака алфа куре', 'турон принт', 'картография', // CRM=0, Excel negative
  'селена трейд', 'васака пак', 'реал принт', // CRM much more negative
];

for (const target of targets) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${target.toUpperCase()}`);
  console.log(`${'='.repeat(60)}`);
  
  for (let m = 0; m < Math.min(12, wb.SheetNames.length); m++) {
    const sheet = wb.Sheets[wb.SheetNames[m]];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, range: 3 });
    const ref = sheet['!ref'];
    const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
    const closingBalanceCol = totalCols - 2;
    const pStart = totalCols - 17;
    const monthStart = new Date(Date.UTC(2024, m, 1));
    const monthEnd = new Date(Date.UTC(2024, m + 1, 1));
    
    let found = false;
    for (const row of rows) {
      if (normLower(row[1]) !== target) continue;
      if (!found) { console.log(`\n  [${MONTH_NAMES[m]}]`); found = true; }
      
      const rowDate = toDate(row[0]);
      const op = norm(row[9]);
      const colC = numVal(row[2]);
      const aa = numVal(row[closingBalanceCol]);
      const rev = numVal(row[8]);
      
      // Payments
      const L = numVal(row[pStart]);
      const O = numVal(row[pStart + 3]);
      const R = numVal(row[pStart + 6]);
      const U = numVal(row[pStart + 9]);
      const X = numVal(row[pStart + 12]);
      const totalPay = L + O + R + U + X;
      
      let cat = 'NEW';
      if (rowDate && !(m === 0)) {
        if (rowDate < monthStart) cat = 'CF';
      }
      if (!rowDate) cat = 'NODATE';
      
      console.log(`    [${cat}] ${rowDate?.toISOString().slice(0,10) || 'N/A'} op=${op} colC=${colC} rev=${rev} AA=${aa} pay=${totalPay}`);
    }
  }
}
