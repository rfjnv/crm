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
    return null;
  }
  return null;
}

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const file = path.join(__dirname, 'data', 'analytics_2024-12-26.xlsx');
const wb = XLSX.readFile(file);

const target = 'мега папер';

for (let m = 0; m < Math.min(12, wb.SheetNames.length); m++) {
  const sheet = wb.Sheets[wb.SheetNames[m]];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, range: 3 });
  const ref = sheet['!ref'];
  const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
  const closingBalanceCol = totalCols - 2;
  const monthStart = new Date(Date.UTC(2024, m, 1));
  const monthEnd = new Date(Date.UTC(2024, m + 1, 1));
  
  let newRows = 0, cfRows = 0, noDateRows = 0;
  
  console.log(`\n=== ${MONTH_NAMES[m]} (Sheet ${m+1}) ===`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const clientName = normLower(row[1]);
    if (clientName !== target) continue;
    
    const rowDate = toDate(row[0]);
    const opType = norm(row[9]);
    const aa = numVal(row[closingBalanceCol]);
    const colC = numVal(row[2]);
    const rev = numVal(row[8]);
    const qty = numVal(row[5]);
    const price = numVal(row[7]);
    
    let category = 'UNKNOWN';
    if (!rowDate) { category = 'NO-DATE'; noDateRows++; }
    else if (rowDate >= monthStart && rowDate < monthEnd) { category = 'NEW'; newRows++; }
    else { category = 'CARRY-FWD'; cfRows++; }
    
    console.log(`  [${category}] Row ${i+4}: date=${rowDate?.toISOString().slice(0,10) || 'N/A'}, op=${opType}, colC=${colC}, rev=${rev}, qty=${qty}, price=${price}, AA=${aa}`);
  }
  console.log(`  Summary: ${newRows} new, ${cfRows} carry-forward, ${noDateRows} no-date`);
}
