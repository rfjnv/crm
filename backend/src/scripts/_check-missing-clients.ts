/**
 * Check which CRM clients with non-zero debt/balance are MISSING from Excel 2026.
 * Cross-references against 2025 Excel as well.
 * READ-ONLY — no INSERT/UPDATE/DELETE.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

/** Normalize a client name: lowercase, trim, collapse internal whitespace */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Extract all unique normalized client names from column B (index 1) of all sheets */
function extractExcelClients(filePath: string): Set<string> {
  const clients = new Set<string>();
  if (!fs.existsSync(filePath)) {
    console.warn(`  WARNING: File not found: ${filePath}`);
    return clients;
  }
  const wb = XLSX.readFile(filePath);
  console.log(`  File: ${path.basename(filePath)}, sheets: [${wb.SheetNames.join(', ')}]`);

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.toLowerCase().trim();
    // Skip utility sheets
    if (sn === 'лист1' || sn === 'лист2' || sn === 'sheet1' || sn === 'sheet2') continue;

    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    let sheetClientCount = 0;
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const rawName = String(row[1] || '').trim();
      if (!rawName) continue;
      const norm = normalize(rawName);
      if (norm.length > 0) {
        clients.add(norm);
        sheetClientCount++;
      }
    }
    console.log(`    Sheet "${sheetName}": ${sheetClientCount} client rows`);
  }

  return clients;
}

/** Check if a CRM name matches any Excel name using fuzzy/substring approaches */
function fuzzyMatch(
  crmNorm: string,
  excelSet: Set<string>
): { found: boolean; matchType: string; matchedName?: string } {
  // 1. Exact match
  if (excelSet.has(crmNorm)) {
    return { found: true, matchType: 'exact', matchedName: crmNorm };
  }

  // 2. Try matching with word reordering (e.g. "спс ибрагим" vs "ибрагим спс")
  const crmWords = crmNorm.split(' ').filter(w => w.length > 0);
  for (const excelName of excelSet) {
    const excelWords = excelName.split(' ').filter(w => w.length > 0);

    // Word-set match: same words in different order
    if (crmWords.length === excelWords.length && crmWords.length > 1) {
      const crmSorted = [...crmWords].sort().join(' ');
      const excelSorted = [...excelWords].sort().join(' ');
      if (crmSorted === excelSorted) {
        return { found: true, matchType: 'reordered', matchedName: excelName };
      }
    }

    // 3. Substring: CRM name contains Excel name or vice versa (min 3 chars)
    if (crmNorm.length >= 3 && excelName.length >= 3) {
      if (crmNorm.includes(excelName) || excelName.includes(crmNorm)) {
        return { found: true, matchType: 'substring', matchedName: excelName };
      }
    }

    // 4. All CRM words appear in the Excel name (for multi-word names)
    if (crmWords.length >= 2 && crmWords.every(w => excelName.includes(w))) {
      return { found: true, matchType: 'all-words-in', matchedName: excelName };
    }

    // 5. All Excel words appear in the CRM name
    if (excelWords.length >= 2 && excelWords.every(w => crmNorm.includes(w))) {
      return { found: true, matchType: 'all-words-in', matchedName: excelName };
    }
  }

  return { found: false, matchType: 'none' };
}

function formatNum(n: number): string {
  return n.toLocaleString('ru-RU');
}

async function main() {
  console.log('=== CHECK MISSING CLIENTS: CRM vs Excel ===\n');

  // --- Step 1: Read Excel 2026 ---
  console.log('Step 1: Reading Excel 2026...');
  const excel2026Path = path.resolve(process.cwd(), '..', '03.03.2026.xlsx');
  const clients2026 = extractExcelClients(excel2026Path);
  console.log(`  Total unique clients in 2026 Excel: ${clients2026.size}\n`);

  // --- Step 2: Read Excel 2025 ---
  console.log('Step 2: Reading Excel 2025...');
  const excel2025Path = path.resolve(process.cwd(), '..', '29.12.2025.xlsx');
  const clients2025 = extractExcelClients(excel2025Path);
  console.log(`  Total unique clients in 2025 Excel: ${clients2025.size}\n`);

  // --- Step 3: Query CRM ---
  console.log('Step 3: Querying CRM for clients with non-zero balance...');
  const crmClients = await prisma.$queryRaw<{
    id: string;
    company_name: string;
    deals: string;
    total_amount: string;
    total_paid: string;
    gross_debt: string;
    net_balance: string;
  }[]>(
    Prisma.sql`
    SELECT c.id, c.company_name,
      COUNT(d.id)::text as deals,
      SUM(d.amount)::text as total_amount,
      SUM(d.paid_amount)::text as total_paid,
      SUM(GREATEST(d.amount - d.paid_amount, 0))::text as gross_debt,
      SUM(d.amount - d.paid_amount)::text as net_balance
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY c.id, c.company_name
    HAVING SUM(d.amount - d.paid_amount) != 0
    ORDER BY ABS(SUM(d.amount - d.paid_amount)) DESC
    `
  );
  console.log(`  CRM clients with non-zero balance: ${crmClients.length}\n`);

  // --- Step 4: Cross-reference ---
  console.log('Step 4: Cross-referencing...\n');

  interface MissingClient {
    company_name: string;
    gross_debt: number;
    net_balance: number;
    deals: number;
    found_in_2025: boolean;
    match_2025_type: string;
    matched_2025_name?: string;
    status: string;
  }

  const missingClients: MissingClient[] = [];
  let foundIn2026Count = 0;
  let foundIn2026FuzzyCount = 0;

  for (const client of crmClients) {
    const crmNorm = normalize(client.company_name);

    // Check 2026
    const match2026 = fuzzyMatch(crmNorm, clients2026);

    if (match2026.found) {
      foundIn2026Count++;
      if (match2026.matchType !== 'exact') {
        foundIn2026FuzzyCount++;
      }
      continue; // Found in 2026, skip
    }

    // NOT in 2026 — check 2025
    const match2025 = fuzzyMatch(crmNorm, clients2025);

    const grossDebt = Number(client.gross_debt);
    const netBalance = Number(client.net_balance);
    const deals = Number(client.deals);

    missingClients.push({
      company_name: client.company_name.trim(),
      gross_debt: grossDebt,
      net_balance: netBalance,
      deals,
      found_in_2025: match2025.found,
      match_2025_type: match2025.matchType,
      matched_2025_name: match2025.matchedName,
      status: match2025.found ? 'ONLY_IN_2025' : 'NOT_IN_ANY_EXCEL',
    });
  }

  // Sort by absolute net_balance descending
  missingClients.sort((a, b) => Math.abs(b.net_balance) - Math.abs(a.net_balance));

  // --- Step 5: Print table ---
  console.log('='.repeat(140));
  console.log('CLIENTS MISSING FROM EXCEL 2026 (with non-zero CRM balance)');
  console.log('='.repeat(140));

  const colW = {
    idx: 4,
    name: 35,
    gross: 18,
    net: 18,
    deals: 6,
    in2025: 10,
    status: 20,
    matchInfo: 25,
  };

  const header = [
    '#'.padStart(colW.idx),
    'Company Name'.padEnd(colW.name),
    'Gross Debt'.padStart(colW.gross),
    'Net Balance'.padStart(colW.net),
    'Deals'.padStart(colW.deals),
    'In 2025?'.padStart(colW.in2025),
    'Status'.padEnd(colW.status),
    'Match Info',
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(140));

  for (let i = 0; i < missingClients.length; i++) {
    const mc = missingClients[i];
    const matchInfo = mc.found_in_2025
      ? `${mc.match_2025_type}: "${mc.matched_2025_name || ''}"`
      : '';

    const row = [
      String(i + 1).padStart(colW.idx),
      mc.company_name.substring(0, colW.name).padEnd(colW.name),
      formatNum(mc.gross_debt).padStart(colW.gross),
      formatNum(mc.net_balance).padStart(colW.net),
      String(mc.deals).padStart(colW.deals),
      (mc.found_in_2025 ? 'yes' : 'no').padStart(colW.in2025),
      mc.status.padEnd(colW.status),
      matchInfo,
    ].join(' | ');
    console.log(row);
  }

  console.log('='.repeat(140));

  // --- Step 6: Summary ---
  console.log('\n=== SUMMARY ===');
  console.log(`CRM clients with non-zero balance: ${crmClients.length}`);
  console.log(`  Found in Excel 2026: ${foundIn2026Count} (${foundIn2026FuzzyCount} via fuzzy match)`);
  console.log(`  MISSING from Excel 2026: ${missingClients.length}`);

  const onlyIn2025 = missingClients.filter(c => c.status === 'ONLY_IN_2025');
  const notInAny = missingClients.filter(c => c.status === 'NOT_IN_ANY_EXCEL');

  console.log(`    - Found in 2025 only: ${onlyIn2025.length}`);
  console.log(`    - Not in any Excel: ${notInAny.length}`);

  const totalGrossMissing = missingClients.reduce((s, c) => s + c.gross_debt, 0);
  const totalNetMissing = missingClients.reduce((s, c) => s + c.net_balance, 0);
  const totalNetPositive = missingClients.filter(c => c.net_balance > 0).reduce((s, c) => s + c.net_balance, 0);
  const totalNetNegative = missingClients.filter(c => c.net_balance < 0).reduce((s, c) => s + c.net_balance, 0);

  console.log(`\n  Missing clients gross debt total: ${formatNum(totalGrossMissing)}`);
  console.log(`  Missing clients net balance total: ${formatNum(totalNetMissing)}`);
  console.log(`    Positive (owed to us): ${formatNum(totalNetPositive)}`);
  console.log(`    Negative (overpaid): ${formatNum(totalNetNegative)}`);

  // Separate totals for ONLY_IN_2025 vs NOT_IN_ANY
  const grossOnly2025 = onlyIn2025.reduce((s, c) => s + c.gross_debt, 0);
  const netOnly2025 = onlyIn2025.reduce((s, c) => s + c.net_balance, 0);
  const grossNotInAny = notInAny.reduce((s, c) => s + c.gross_debt, 0);
  const netNotInAny = notInAny.reduce((s, c) => s + c.net_balance, 0);

  console.log(`\n  ONLY_IN_2025 (${onlyIn2025.length} clients):`);
  console.log(`    Gross debt: ${formatNum(grossOnly2025)}`);
  console.log(`    Net balance: ${formatNum(netOnly2025)}`);

  console.log(`  NOT_IN_ANY_EXCEL (${notInAny.length} clients):`);
  console.log(`    Gross debt: ${formatNum(grossNotInAny)}`);
  console.log(`    Net balance: ${formatNum(netNotInAny)}`);

  console.log(`\nExcel unique client counts:`);
  console.log(`  2026 file (03.03.2026.xlsx): ${clients2026.size} unique clients`);
  console.log(`  2025 file (29.12.2025.xlsx): ${clients2025.size} unique clients`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
