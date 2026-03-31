import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

// ─── Normalize helper ───
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Word-reorder: "Иванов Иван" -> also try "Иван Иванов"
function wordPermutations(s: string): string[] {
  const words = s.split(' ');
  if (words.length <= 1) return [s];
  if (words.length === 2) return [s, words.reverse().join(' ')];
  // For 3+ words, generate all permutations would be expensive,
  // just do original + reversed
  return [s, words.slice().reverse().join(' ')];
}

function formatNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

async function main() {
  // ─── 1. Read Excel and extract all unique client names from column B ───
  const xlsxPath = path.resolve('c:\\Users\\Noutbuk savdosi\\CRM\\03.03.2026.xlsx');
  console.log(`\nReading Excel: ${xlsxPath}\n`);

  const workbook = XLSX.readFile(xlsxPath);
  const sheetNames = workbook.SheetNames;
  console.log(`Sheets found: ${sheetNames.join(', ')}`);

  const excelNamesRaw = new Set<string>();
  const excelNamesNormalized = new Set<string>();
  // Also store all word-reorder variants for fuzzy matching
  const excelNamesExpanded = new Set<string>();

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    for (const row of rows) {
      const cellB = row[1]; // column B = index 1
      if (cellB && typeof cellB === 'string' && cellB.trim().length > 0) {
        const raw = cellB.trim();
        excelNamesRaw.add(raw);
        const norm = normalize(raw);
        excelNamesNormalized.add(norm);
        for (const perm of wordPermutations(norm)) {
          excelNamesExpanded.add(perm);
        }
      }
    }
  }

  console.log(`Unique Excel client names (raw): ${excelNamesRaw.size}`);
  console.log(`Unique Excel client names (normalized): ${excelNamesNormalized.size}`);
  console.log(`Unique Excel client names (with word-reorder): ${excelNamesExpanded.size}\n`);

  // ─── 2. Get CRM clients with positive gross debt ───
  type DebtRow = {
    id: string;
    company_name: string;
    deals: string;
    total_amount: string;
    total_paid: string;
    gross_debt: string;
  };

  const crmDebtors = await prisma.$queryRaw<DebtRow[]>(
    Prisma.sql`
      SELECT c.id, c.company_name,
        COUNT(d.id)::text as deals,
        SUM(d.amount)::text as total_amount,
        SUM(d.paid_amount)::text as total_paid,
        SUM(GREATEST(d.amount - d.paid_amount, 0))::text as gross_debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
      GROUP BY c.id, c.company_name
      HAVING SUM(GREATEST(d.amount - d.paid_amount, 0)) > 0
      ORDER BY SUM(GREATEST(d.amount - d.paid_amount, 0)) DESC
    `
  );

  console.log(`CRM clients with gross_debt > 0: ${crmDebtors.length}\n`);

  // ─── 3. Match CRM clients against Excel names ───
  const groupA: (DebtRow & { matched: boolean })[] = []; // in Excel
  const groupB: (DebtRow & { matched: boolean })[] = []; // NOT in Excel

  for (const row of crmDebtors) {
    const crmNorm = normalize(row.company_name);
    const crmPerms = wordPermutations(crmNorm);

    let found = false;
    for (const perm of crmPerms) {
      if (excelNamesExpanded.has(perm)) {
        found = true;
        break;
      }
    }

    if (found) {
      groupA.push({ ...row, matched: true });
    } else {
      groupB.push({ ...row, matched: false });
    }
  }

  // ─── 4. Print GROUP A ───
  console.log('═'.repeat(90));
  console.log('  GROUP A: IN EXCEL 2026 (CRM debtors found in Excel)');
  console.log('═'.repeat(90));
  console.log(
    '  #'.padEnd(5) +
    'Company Name'.padEnd(40) +
    'Gross Debt'.padStart(20) +
    'Deals'.padStart(8)
  );
  console.log('─'.repeat(90));

  let groupATotal = 0;
  groupA.forEach((r, i) => {
    const debt = Number(r.gross_debt);
    groupATotal += debt;
    console.log(
      `  ${(i + 1).toString().padEnd(4)}` +
      r.company_name.substring(0, 38).padEnd(40) +
      formatNum(debt).padStart(20) +
      r.deals.padStart(8)
    );
  });
  console.log('─'.repeat(90));
  console.log(`  GROUP A Total: ${formatNum(groupATotal)}  (${groupA.length} clients)\n`);

  // ─── 5. Print GROUP B ───
  console.log('═'.repeat(90));
  console.log('  GROUP B: NOT IN EXCEL 2026 (CRM debtors missing from Excel)');
  console.log('═'.repeat(90));
  console.log(
    '  #'.padEnd(5) +
    'Company Name'.padEnd(40) +
    'Gross Debt'.padStart(20) +
    'Deals'.padStart(8)
  );
  console.log('─'.repeat(90));

  let groupBTotal = 0;
  groupB.forEach((r, i) => {
    const debt = Number(r.gross_debt);
    groupBTotal += debt;
    console.log(
      `  ${(i + 1).toString().padEnd(4)}` +
      r.company_name.substring(0, 38).padEnd(40) +
      formatNum(debt).padStart(20) +
      r.deals.padStart(8)
    );
  });
  console.log('─'.repeat(90));
  console.log(`  GROUP B Total: ${formatNum(groupBTotal)}  (${groupB.length} clients)\n`);

  // ─── 6. Summary ───
  const crmGrossTotal = groupATotal + groupBTotal;
  const excelTotal = 987_116_723;
  const gap = crmGrossTotal - excelTotal;

  console.log('═'.repeat(90));
  console.log('  SUMMARY');
  console.log('═'.repeat(90));
  console.log(`  Total CRM gross debt:          ${formatNum(crmGrossTotal)}`);
  console.log(`  GROUP A (in Excel):            ${formatNum(groupATotal)}  (${groupA.length} clients)`);
  console.log(`  GROUP B (NOT in Excel):        ${formatNum(groupBTotal)}  (${groupB.length} clients)`);
  console.log(`  Excel 2026 total (user):       ${formatNum(excelTotal)}`);
  console.log(`  Gap (CRM - Excel):             ${formatNum(gap)}`);
  console.log(`  GROUP B total:                 ${formatNum(groupBTotal)}`);
  console.log(`  Gap === GROUP B?               ${Math.abs(gap - groupBTotal) < 1 ? 'YES' : 'NO'} (diff: ${formatNum(Math.abs(gap - groupBTotal))})`);
  console.log('═'.repeat(90));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
