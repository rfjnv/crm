import * as XLSX from 'xlsx';
const wb = XLSX.readFile('../analytics_2026-03-12.xlsx');

for (let si = 0; si < wb.SheetNames.length; si++) {
  const sheet = wb.Sheets[wb.SheetNames[si]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
  
  const byDate = new Map<string, { withProduct: number; withoutProduct: number; total: number; missingRows: string[] }>();
  
  for (const row of rows) {
    const dateVal = row[0];
    if (!dateVal) continue;
    
    let d: Date | null = null;
    if (typeof dateVal === 'number') {
      const parsed = XLSX.SSF.parse_date_code(dateVal);
      d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    } else if (dateVal instanceof Date) {
      d = dateVal;
    }
    if (!d || isNaN(d.getTime())) continue;
    
    const key = d.toISOString().slice(0, 10);
    const rev = typeof row[8] === 'number' ? row[8] : 0;
    const hasProduct = !!row[3];
    
    if (!byDate.has(key)) byDate.set(key, { withProduct: 0, withoutProduct: 0, total: 0, missingRows: [] });
    const entry = byDate.get(key)!;
    entry.total += rev;
    
    if (hasProduct) {
      entry.withProduct += rev;
    } else {
      entry.withoutProduct += rev;
      if (rev > 0) entry.missingRows.push(`${row[1]} | ${row[4]} | rev=${rev.toLocaleString()}`);
    }
  }
  
  console.log(`\n=== ${wb.SheetNames[si]} ===`);
  let sheetTotal = 0, sheetMissing = 0;
  
  for (const [date, data] of [...byDate.entries()].sort()) {
    sheetTotal += data.total;
    sheetMissing += data.withoutProduct;
    const pct = data.total > 0 ? ((data.withoutProduct / data.total) * 100).toFixed(0) : '0';
    const flag = data.withoutProduct > 0 ? ' ⚠️' : '';
    console.log(`${date}: Excel=${data.total.toLocaleString()} | CRM(old)=${data.withProduct.toLocaleString()} | Missing=${data.withoutProduct.toLocaleString()} (${pct}%)${flag}`);
  }
  console.log(`\nSheet total: ${sheetTotal.toLocaleString()} | Missing: ${sheetMissing.toLocaleString()} (${sheetTotal > 0 ? ((sheetMissing / sheetTotal) * 100).toFixed(1) : 0}%)`);
}
