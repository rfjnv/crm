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

// Check December sheet (last one)
const sheetCount = Math.min(12, wb.SheetNames.length);
const decSheet = wb.Sheets[wb.SheetNames[sheetCount - 1]];
const decRows = XLSX.utils.sheet_to_json<any[]>(decSheet, { header: 1, range: 3 });
const ref = decSheet['!ref'];
const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
const closingBalanceCol = totalCols - 2;

// Build map: client -> sum of AA in December for PP rows
const clientDecPP = new Map<string, number>();
const clientDecDebt = new Map<string, number>();

for (const row of decRows) {
  const clientName = normLower(row[1]);
  if (!clientName) continue;
  const opRaw = normLower(row[9]);
  const aa = numVal(row[closingBalanceCol]);
  
  if (opRaw === 'пп') {
    clientDecPP.set(clientName, (clientDecPP.get(clientName) || 0) + aa);
  }
  if (['к', 'н/к', 'п/к', 'ф'].includes(opRaw)) {
    clientDecDebt.set(clientName, (clientDecDebt.get(clientName) || 0) + aa);
  }
}

// Reconciliation clients with negative net (PP credits)
const ppSverkaClients = [
  { name: 'картография', net: -100000 },
  { name: 'ахмад ака алфа куре', net: -16486000 },
  { name: 'турон принт', net: -1200000 },
  { name: 'васака пак', net: -300000 },
  { name: 'алишер самарканд', net: -260000 },
  { name: 'андрей оренж', net: -400000 },
];

console.log('=== Clients with PP Сверка deals ===\n');
for (const c of ppSverkaClients) {
  const decPP = clientDecPP.get(c.name) || 0;
  const decDebt = clientDecDebt.get(c.name) || 0;
  console.log(`${c.name}:`);
  console.log(`  Сверка net: ${c.net}`);
  console.log(`  December PP rows AA sum: ${decPP}`);
  console.log(`  December debt rows AA sum: ${decDebt}`);
  console.log(`  → ${decPP !== 0 ? 'HAS PP in December ✓' : '⚠️ NO PP in December!'}`);
}

// Also check "планета принт" specifically 
console.log('\n=== Планета принт in December ===');
for (const row of decRows) {
  if (normLower(row[1]) === 'планета принт') {
    console.log(`  op=${norm(row[9])}, AA=${numVal(row[closingBalanceCol])}, colC=${numVal(row[2])}`);
  }
}

// Check ALL clients that have negative AA (PP) anywhere in ALL months but NOT in December
console.log('\n=== Clients with PP in earlier months but NOT in December ===');
const allMonthsPP = new Map<string, number>();
for (let m = 0; m < sheetCount - 1; m++) {
  const sheet = wb.Sheets[wb.SheetNames[m]];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, range: 3 });
  const r = sheet['!ref'];
  const tc = r ? XLSX.utils.decode_range(r).e.c + 1 : 28;
  const aaCol = tc - 2;
  for (const row of rows) {
    const cn = normLower(row[1]);
    if (!cn) continue;
    if (normLower(row[9]) === 'пп') {
      allMonthsPP.set(cn, (allMonthsPP.get(cn) || 0) + numVal(row[aaCol]));
    }
  }
}

for (const [client, ppVal] of allMonthsPP) {
  const decPP = clientDecPP.get(client) || 0;
  if (ppVal < 0 && decPP === 0) {
    console.log(`  ${client}: had PP (${ppVal}) in earlier months, but NO PP in December`);
  }
}
