import * as XLSX from 'xlsx';
const wb = XLSX.readFile('../analytics_2026-03-12.xlsx');
console.log('Sheets:', wb.SheetNames);

for (let si = 0; si < wb.SheetNames.length; si++) {
  const sheet = wb.Sheets[wb.SheetNames[si]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
  
  let march12Sum = 0;
  let march12Count = 0;
  let march12Rows: any[] = [];
  
  for (const row of rows) {
    const dateVal = row[0];
    const revenue = row[8];
    
    if (!dateVal) continue;
    
    let d: Date | null = null;
    if (dateVal instanceof Date) {
      d = dateVal;
    } else if (typeof dateVal === 'number') {
      const parsed = XLSX.SSF.parse_date_code(dateVal);
      d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    } else if (typeof dateVal === 'string') {
      d = new Date(dateVal);
    }
    
    if (!d || isNaN(d.getTime())) continue;
    
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const year = d.getUTCFullYear();
    
    if (month === 3 && day === 12 && year === 2026) {
      const rev = typeof revenue === 'number' ? revenue : parseFloat(String(revenue || '0').replace(/,/g, '').replace(/\s/g, ''));
      march12Sum += rev || 0;
      march12Count++;
      march12Rows.push({
        client: row[1],
        product: row[3],
        qty: row[5],
        price: row[7],
        revenue: revenue,
        opType: row[9],
      });
    }
  }
  
  if (march12Count > 0) {
    console.log(`\n=== Sheet: ${wb.SheetNames[si]} ===`);
    console.log(`March 12 rows: ${march12Count}, Sum Column I: ${march12Sum.toLocaleString()}`);
    for (const r of march12Rows) {
      console.log(`  ${r.client} | ${r.product} | qty=${r.qty} | price=${r.price} | rev=${r.revenue} | op=${r.opType}`);
    }
  }
}
