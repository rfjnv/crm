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
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y >= 1900 && d.y <= 2100) return new Date(Date.UTC(d.y, d.m - 1, d.d));
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() < 1900 || parsed.getFullYear() > 2100) return null;
  return parsed;
}

const file = path.join(__dirname, 'data', 'analytics_2024-12-26.xlsx');
const wb = XLSX.readFile(file);
const sheet = wb.Sheets[wb.SheetNames[0]];

const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, range: 3 });

const ref = sheet['!ref'];
const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
const closingBalanceCol = totalCols - 2;

const targets = ['вектор принт', 'мега папер', 'диёр принт', 'бест экспресс принт'];

for (const target of targets) {
  let colC = 0;
  let histDealSum = 0;
  let histPayments = 0;
  console.log(`\n--- ${target.toUpperCase()} ---`);
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const clientName = normLower(row[1]);
    if (clientName === target) {
      if (colC === 0) colC = numVal(row[2]); // Col C
      
      const dealDate = toDate(row[0]);
      if (dealDate && dealDate.getFullYear() < 2024) {
          const rev = numVal(row[8]);
          const qty = numVal(row[5]);
          const price = numVal(row[7]);
          const aa = numVal(row[closingBalanceCol]);
          let inferredAmount = rev > 0 ? rev : (qty*price);
          if (inferredAmount === 0 && aa > 0) inferredAmount = aa;
          
          histDealSum += inferredAmount;
          console.log(` Hist row ${i+4}: date=${dealDate.toISOString()}, amount=${inferredAmount}`);
      }
    }
  }
  console.log(`Col C Opening Balance: ${colC}`);
  console.log(`Sum of explicitly imported historical deals: ${histDealSum}`);
  console.log(`Missing Debt Amount = ${colC - histDealSum}`);
}
