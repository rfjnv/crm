import * as XLSX from 'xlsx';
import path from 'path';
import { normalizeClientName } from './src/lib/normalize-client';

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

async function check() {
  const filePath = path.resolve(process.cwd(), 'data/analytics_2025-12-29.xlsx');
  const wb = XLSX.readFile(filePath);
  
  for (let i = 0; i < 12; i++) {
    const sheet = wb.Sheets[wb.SheetNames[i]];
    if (!sheet) continue;
    
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
    const printRows = rows.filter(r => normalizeClientName(norm(r[1])) === normalizeClientName('принт вел'));
    
    if (printRows.length > 0) {
      console.log(`\n--- ${wb.SheetNames[i]} ---`);
      for (const row of printRows) {
        console.log(`Date: ${row[0]} | Prod: ${row[4]} | Qty: ${row[5]} | Price: ${row[7]}`);
      }
    }
  }
}

check().catch(console.error);
