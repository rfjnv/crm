/**
 * Quick check: sum all client opening balances from January 2025
 */
import * as XLSX from 'xlsx';
import path from 'path';

const fpath = path.resolve(process.cwd(), '..', '29.12.2025.xlsx');
const wb = XLSX.readFile(fpath);

// First sheet = January 2025
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

console.log(`Sheet: ${wb.SheetNames[0]}`);
console.log(`Row 0: ${(data[0] as unknown[])?.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('=')).join(' | ')}`);
console.log(`Row 1: ${(data[1] as unknown[])?.map((c, j) => `[${j}]=${c}`).filter(s => !s.endsWith('=')).join(' | ')}`);

// Sum opening balances (col 2) — first row per client
const seen = new Set<string>();
let totalOpening = 0;
let clientsWithOpening = 0;
const topClients: { name: string; opening: number }[] = [];

for (let i = 3; i < data.length; i++) {
  const row = data[i] as unknown[];
  if (!row) continue;
  const client = String(row[1] || '').trim().toLowerCase();
  if (!client) continue;

  if (!seen.has(client)) {
    seen.add(client);
    const opening = Number(row[2]) || 0;
    if (opening !== 0) {
      totalOpening += opening;
      clientsWithOpening++;
      topClients.push({ name: String(row[1] || '').trim(), opening });
    }
  }
}

topClients.sort((a, b) => Math.abs(b.opening) - Math.abs(a.opening));

console.log(`\nTotal unique clients: ${seen.size}`);
console.log(`Clients with non-zero opening: ${clientsWithOpening}`);
console.log(`Total opening balance sum: ${totalOpening.toLocaleString()}`);

console.log(`\nTop 20 clients by opening balance:`);
for (const c of topClients.slice(0, 20)) {
  console.log(`  "${c.name}" opening=${c.opening.toLocaleString()}`);
}

// Also check closing balances sum in Feb 2026
const fpath2 = path.resolve(process.cwd(), '..', '28.02.2026.xlsx');
const wb2 = XLSX.readFile(fpath2);

// February 2026 sheet (index 1)
const febSheet = wb2.Sheets[wb2.SheetNames[1]];
const febData = XLSX.utils.sheet_to_json(febSheet, { header: 1, defval: '' }) as unknown[][];

// Find closing balance column
const h0 = febData[0] as unknown[];
let closingCol = -1;
for (let j = (h0?.length || 0) - 1; j >= 0; j--) {
  if (String(h0?.[j] || '').toLowerCase().startsWith('ост')) {
    closingCol = j;
    break;
  }
}
console.log(`\nFeb 2026 sheet: ${wb2.SheetNames[1]}, closingCol=${closingCol}`);

// Sum closing balances — last row per client
const clientClosing = new Map<string, number>();
for (let i = 3; i < febData.length; i++) {
  const row = febData[i] as unknown[];
  if (!row) continue;
  const client = String(row[1] || '').trim().toLowerCase();
  if (!client) continue;
  const closing = Number(row[closingCol]) || 0;
  // Each row has a closing; last row for client is the final closing
  clientClosing.set(client, closing);
}

let totalClosing = 0;
for (const [, val] of clientClosing) {
  totalClosing += val;
}
console.log(`Feb 2026 total closing balance: ${totalClosing.toLocaleString()}`);
console.log(`\nReconciliation:`);
console.log(`  Opening (Jan 2025): ${totalOpening.toLocaleString()}`);
console.log(`  + Excel sales: 30,716,339,518`);
console.log(`  - Excel payments: 22,905,947,538`);
console.log(`  = Expected closing: ${(totalOpening + 30716339518 - 22905947538).toLocaleString()}`);
console.log(`  Actual closing (Feb 2026): ${totalClosing.toLocaleString()}`);

console.log(`\nCRM perspective:`);
console.log(`  CRM deal amounts (no pre-2025): 31,784,536,788`);
console.log(`  CRM payments: 22,905,947,538`);
console.log(`  CRM net debt: ${(31784536788 - 22905947538).toLocaleString()}`);
console.log(`  Should be: opening + sales - payments = ${(totalOpening + 30716339518 - 22905947538).toLocaleString()}`);
console.log(`  Missing from CRM: negative opening balances (prepay) = ${totalOpening.toLocaleString()}`);
