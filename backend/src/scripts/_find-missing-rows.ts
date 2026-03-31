import * as XLSX from 'xlsx';

const wb = XLSX.readFile('../analytics_2026-03-12.xlsx');
const ws = wb.Sheets[wb.SheetNames[2]];
const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

const debtTypes = ['к','н/к','п/к','ф'];
const ppTypes = ['пп'];

let noProductCount = 0;
let noProductAB = 0;

for (const row of rows) {
  const product = String(row[4] || '').trim();
  const ab = typeof row[27] === 'number' ? row[27] : 0;
  const opType = String(row[9] || '').trim().toLowerCase();
  const isDebtOrPP = debtTypes.includes(opType) || ppTypes.includes(opType);

  if (product === '' && isDebtOrPP && ab !== 0) {
    noProductCount++;
    noProductAB += ab;
    console.log(`No product: client="${row[1]}" op="${opType}" AB=${ab}`);
  }
}
console.log(`\nRows without product but with debt/PP AB: ${noProductCount}`);
console.log(`Total AB of these rows: ${noProductAB.toLocaleString('ru-RU')}`);
