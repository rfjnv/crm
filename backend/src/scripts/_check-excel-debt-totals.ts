import * as XLSX from 'xlsx';

// Read all rows from March sheet and compute totals per client
const wb = XLSX.readFile('../analytics_2026-03-12.xlsx');
const ws = wb.Sheets[wb.SheetNames[2]]; // March
const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

const debtTypes = ['к','н/к','п/к','ф'];
const ppTypes = ['пп'];

let totalNet = 0;
let totalPP = 0;
let missingClients: string[] = [];

// Build per-client totals from Excel
const excelClients = new Map<string, { net: number; pp: number }>();
for (const row of rows) {
  const clientName = norm(row[1]);
  if (!clientName) continue;
  const ab = typeof row[27] === 'number' ? row[27] : 0;
  const opType = String(row[9] || '').trim().toLowerCase();

  if (!excelClients.has(clientName.toLowerCase())) {
    excelClients.set(clientName.toLowerCase(), { net: 0, pp: 0 });
  }
  const entry = excelClients.get(clientName.toLowerCase())!;

  if (debtTypes.includes(opType)) {
    entry.net += ab;
    totalNet += ab;
  } else if (ppTypes.includes(opType)) {
    entry.pp += ab;
    totalPP += ab;
  }
}

console.log('Excel totals:');
console.log('  Net:', totalNet.toLocaleString('ru-RU'));
console.log('  PP:', totalPP.toLocaleString('ru-RU'));
console.log('  Gross:', (totalNet + totalPP).toLocaleString('ru-RU'));
console.log('  Clients with debt data:', excelClients.size);

// Find clients with debt > 1M
const bigClients = [...excelClients.entries()]
  .filter(([_, v]) => Math.abs(v.net) > 1000000)
  .sort((a, b) => b[1].net - a[1].net);
console.log('\nTop clients (net > 1M):');
for (const [name, data] of bigClients.slice(0, 15)) {
  console.log(`  ${name.padEnd(30)} net: ${data.net.toLocaleString('ru-RU').padStart(15)}  pp: ${data.pp.toLocaleString('ru-RU').padStart(12)}`);
}
