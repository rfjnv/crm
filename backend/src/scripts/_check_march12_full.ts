import * as XLSX from 'xlsx';
const wb = XLSX.readFile('../analytics_2026-03-12.xlsx');
const sheet = wb.Sheets['март 2026'];
const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });

// Show all columns for March 12 rows
console.log('Column indices: 0=A(date), 1=B(client), 2=C(manager), 3=D(product), 4=E(format), 5=F(qty), 6=G(unit), 7=H(price), 8=I(revenue), 9=J(opType), 10=K, 11=L, 12=M(closingBal)\n');

let totalWithProduct = 0;
let totalWithoutProduct = 0;

for (const row of rows) {
  const dateVal = row[0];
  if (!dateVal) continue;
  
  let d: Date | null = null;
  if (typeof dateVal === 'number') {
    const parsed = XLSX.SSF.parse_date_code(dateVal);
    d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  if (!d) continue;
  
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (month !== 3 || day !== 12) continue;
  
  const rev = typeof row[8] === 'number' ? row[8] : 0;
  const hasProduct = !!row[3];
  
  if (hasProduct) totalWithProduct += rev;
  else totalWithoutProduct += rev;
  
  console.log(`A=${d.toISOString().slice(0,10)} | B(client)="${row[1]}" | C(mgr)="${row[2]}" | D(product)="${row[3]}" | E="${row[4]}" | F(qty)=${row[5]} | G="${row[6]}" | H(price)=${row[7]} | I(rev)=${rev} | J(op)="${row[9]}" | M(closBal)=${row[12]}`);
}

console.log(`\nWith product: ${totalWithProduct.toLocaleString()}`);
console.log(`Without product: ${totalWithoutProduct.toLocaleString()}`);
console.log(`Total: ${(totalWithProduct + totalWithoutProduct).toLocaleString()}`);
