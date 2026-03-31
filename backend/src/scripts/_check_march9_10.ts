import * as XLSX from 'xlsx';
const wb = XLSX.readFile('../analytics_2026-03-12.xlsx');

// Check March sheet
const sheet = wb.Sheets['март 2026'];
const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });

const COL_DATE = 0, COL_CLIENT = 1, COL_PRODUCT = 3, COL_QTY = 5, COL_PRICE = 7, COL_REVENUE = 8, COL_OP_TYPE = 9;

const numVal = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const s = String(v).replace(/,/g, '.').replace(/\s/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

for (const targetDay of [9, 10]) {
  let totalRevenue = 0;
  let withProduct = 0;
  let withoutProduct = 0;
  let rowCount = 0;

  console.log(`\n=== March ${targetDay} ===`);

  for (const row of rows) {
    const dateVal = row[0];
    if (!dateVal || typeof dateVal !== 'number') continue;

    const parsed = XLSX.SSF.parse_date_code(dateVal);
    const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));

    if (d.getUTCMonth() !== 2 || d.getUTCDate() !== targetDay || d.getUTCFullYear() !== 2026) continue;

    const rev = numVal(row[COL_REVENUE]);
    const hasProduct = !!row[COL_PRODUCT];
    totalRevenue += rev;
    rowCount++;

    if (hasProduct) withProduct += rev;
    else withoutProduct += rev;

    console.log(`  ${row[COL_CLIENT]} | product="${row[COL_PRODUCT]}" | qty=${row[COL_QTY]} | price=${row[COL_PRICE]} | rev=${rev.toLocaleString()} | op=${row[COL_OP_TYPE]}`);
  }

  console.log(`  TOTAL: ${totalRevenue.toLocaleString()} (${rowCount} rows, with product: ${withProduct.toLocaleString()}, without: ${withoutProduct.toLocaleString()})`);
}

// Also check: what dates have rows in the sheet but NO revenue (Column I = 0)?
console.log('\n=== Dates with zero revenue in March sheet ===');
const dateRevMap = new Map<string, {total: number, rows: number}>();
for (const row of rows) {
  const dateVal = row[0];
  if (!dateVal || typeof dateVal !== 'number') continue;
  const parsed = XLSX.SSF.parse_date_code(dateVal);
  const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  if (d.getUTCFullYear() !== 2026 || d.getUTCMonth() !== 2) continue;

  const key = `March ${d.getUTCDate()}`;
  const rev = numVal(row[COL_REVENUE]);
  if (!dateRevMap.has(key)) dateRevMap.set(key, {total: 0, rows: 0});
  const e = dateRevMap.get(key)!;
  e.total += rev;
  e.rows++;
}

for (const [date, data] of [...dateRevMap.entries()].sort()) {
  console.log(`  ${date}: ${data.total.toLocaleString()} (${data.rows} rows)`);
}
