import * as XLSX from 'xlsx';
import path from 'path';

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}
function parseStock(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (!str) return 0;
  const match = str.match(/^(\d+(?:[.,]\d+)?)/);
  if (!match) return 0;
  return parseFloat(match[1].replace(',', '.')) || 0;
}

const filePath = path.resolve(process.cwd(), '../остаток 02 (3).xlsx');
const wb = XLSX.readFile(filePath);

console.log('=== SHEETS IN WORKBOOK ===');
console.log('Sheet names:', wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  console.log(`\n=== Sheet "${sheetName}" — total rows: ${data.length} ===`);

  // Show headers (first 3 rows)
  for (let i = 0; i < Math.min(3, data.length); i++) {
    const row = data[i] as unknown[];
    if (!row) continue;
    console.log(`  Header[${i}]: cols=${row.length}`);
    for (let c = 0; c < row.length; c++) {
      if (row[c] != null) console.log(`    col[${c}] = ${JSON.stringify(row[c])}`);
    }
  }

  // Find all rows for "Самоклеющаяся бумага" + format "70*100" (белая)
  console.log(`\n  --- "70*100" белая rows in this sheet ---`);
  const key70x100: { row: number; col7: unknown; parsed: number }[] = [];
  for (let i = 3; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row?.[1]) continue;
    const name = norm(row[1]);
    const format = norm(row[2]);
    if (name.toLowerCase().includes('самоклеющ') && name.toLowerCase().includes('белая') && format === '70*100') {
      const stock = parseStock(row[7]);
      key70x100.push({ row: i, col7: row[7], parsed: stock });
      console.log(`  Row ${i}: col7=${JSON.stringify(row[7])} parsed=${stock}`);
    }
  }

  // Show what happens with Map deduplication
  console.log(`\n  Total "70*100" белая occurrences: ${key70x100.length}`);
  if (key70x100.length > 0) {
    console.log(`  FIRST value: ${key70x100[0].parsed} (row ${key70x100[0].row})`);
    console.log(`  LAST value:  ${key70x100[key70x100.length - 1].parsed} (row ${key70x100[key70x100.length - 1].row})`);
  }

  // Count total unique products vs total product rows
  const allKeys = new Set<string>();
  let totalDataRows = 0;
  for (let i = 3; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row?.[1]) continue;
    totalDataRows++;
    const name = norm(row[1]).toLowerCase();
    const format = norm(row[2]).toLowerCase();
    allKeys.add(name + '|||' + format);
  }
  console.log(`\n  Total data rows: ${totalDataRows}`);
  console.log(`  Unique name+format keys: ${allKeys.size}`);
  console.log(`  DUPLICATES (rows - unique): ${totalDataRows - allKeys.size}`);

  // Detect sections — find row numbers where the same product reappears
  console.log('\n  --- Detecting sections ---');
  const firstSeen = new Map<string, number>();
  const sectionStarts: number[] = [];
  for (let i = 3; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row?.[1]) continue;
    const name = norm(row[1]).toLowerCase();
    const format = norm(row[2]).toLowerCase();
    const key = name + '|||' + format;
    if (firstSeen.has(key) && !sectionStarts.includes(i)) {
      // Product we've seen before — this might be a new section start
      // Check if this is roughly the first product in a new block
      const prev = firstSeen.get(key)!;
      if (i - prev > 20) { // Must be at least 20 rows apart
        sectionStarts.push(i);
        console.log(`  Section break at row ${i} (same product "${name.substring(0, 40)}" was at row ${prev})`);
      }
    }
    if (!firstSeen.has(key)) firstSeen.set(key, i);
  }
  console.log(`  Total sections detected: ${sectionStarts.length + 1}`);
}
