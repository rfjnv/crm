/**
 * Phase 3: Reset deal.amount from Excel data (per client per month).
 *
 * For each active deal with title "Клиент — Месяц Год":
 *   1. Find the client's rows in the matching Excel sheet
 *   2. Set deal.amount = SUM of Excel row amounts (col I/8)
 *   3. Exclude rows with mark "обмен" (exchange)
 *
 * Run:
 *   cd backend && npx tsx src/scripts/rebuild/phase3-amounts.ts            # dry-run
 *   cd backend && npx tsx src/scripts/rebuild/phase3-amounts.ts --apply    # live
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../../lib/normalize-client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const MONTH_NAMES_RU: Record<string, number> = {
  'январь': 0, 'февраль': 1, 'март': 2, 'апрель': 3, 'май': 4, 'июнь': 5,
  'июль': 6, 'август': 7, 'сентябрь': 8, 'октябрь': 9, 'ноябрь': 10, 'декабрь': 11,
};

const EXCEL_FILES = [
  { name: '26.12.2024.xlsx', defaultYear: 2024 },
  { name: '29.12.2025.xlsx', defaultYear: 2025 },
  { name: '10.03.2026.xlsx', defaultYear: 2026 },
];

const AMOUNT_COL = 8; // Column I (0-based)
const NKP_COL = 9;    // Column J

type Row = unknown[];

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

/**
 * Build a map: "normalizedClient|sheetKey" → SUM(amount from Excel rows)
 * sheetKey = "январь 2025" etc.
 */
function buildExcelAmounts(): Map<string, number> {
  const map = new Map<string, number>();

  for (const file of EXCEL_FILES) {
    const fpath = path.resolve(process.cwd(), '..', file.name);
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.readFile(fpath);
    } catch {
      console.log(`  WARNING: Cannot read ${file.name}`);
      continue;
    }

    for (const sheetName of wb.SheetNames) {
      const sn = sheetName.toLowerCase().trim();

      // Detect month
      let monthName = '';
      for (const [name] of Object.entries(MONTH_NAMES_RU)) {
        if (sn.startsWith(name)) { monthName = name; break; }
      }
      if (!monthName) continue;

      const yearMatch = sheetName.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : file.defaultYear;

      // Build the sheet key to match deal titles (capitalized month)
      const capitalMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
      const sheetKey = `${capitalMonth} ${year}`;

      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

      for (let i = 3; i < data.length; i++) {
        const row = data[i] as Row;
        if (!row) continue;
        const clientName = normalizeClientName(row[1]);
        if (!clientName) continue;

        // Skip exchange rows
        const nkp = norm(row[NKP_COL]).toLowerCase();
        if (nkp === 'обмен') continue;

        const amount = numVal(row[AMOUNT_COL]);
        const key = `${clientName}|${sheetKey}`;
        map.set(key, (map.get(key) || 0) + amount);
      }
    }
  }

  return map;
}

/**
 * Parse deal title to extract month+year part.
 * Titles are like: "клиент — Январь 2025" or "клиент — Январь 2025"
 * Returns "Январь 2025" or null.
 */
function extractSheetKey(title: string): string | null {
  const match = title.match(/\s*[—–-]\s*(\S+\s+\d{4})$/);
  return match ? match[1] : null;
}

async function main() {
  console.log(`=== Phase 3: RESET DEAL AMOUNTS FROM EXCEL ${APPLY ? '*** APPLY ***' : '(dry-run)'} ===\n`);

  // Build Excel amounts index
  console.log('Building Excel amounts index...');
  const excelAmounts = buildExcelAmounts();
  console.log(`  ${excelAmounts.size} client-month entries\n`);

  // Get all active deals with their client info
  const deals = await prisma.deal.findMany({
    where: { isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
    select: { id: true, title: true, amount: true, clientId: true, client: { select: { companyName: true } } },
  });

  console.log(`Active deals: ${deals.length}\n`);

  let matched = 0;
  let unmatched = 0;
  let changed = 0;
  let totalOldAmount = 0;
  let totalNewAmount = 0;
  const unmatchedExamples: string[] = [];

  for (const deal of deals) {
    const sheetKey = extractSheetKey(deal.title);
    if (!sheetKey) {
      unmatched++;
      if (unmatchedExamples.length < 10) unmatchedExamples.push(deal.title);
      totalOldAmount += Number(deal.amount);
      totalNewAmount += Number(deal.amount); // keep as is
      continue;
    }

    const normClient = normalizeClientName(deal.client.companyName);
    const key = `${normClient}|${sheetKey}`;
    const excelAmount = excelAmounts.get(key);

    if (excelAmount === undefined) {
      unmatched++;
      if (unmatchedExamples.length < 10) unmatchedExamples.push(`${deal.title} (key: ${key})`);
      totalOldAmount += Number(deal.amount);
      totalNewAmount += Number(deal.amount); // keep as is
      continue;
    }

    matched++;
    const oldAmount = Number(deal.amount);
    totalOldAmount += oldAmount;
    totalNewAmount += excelAmount;

    if (Math.abs(oldAmount - excelAmount) > 0.01) {
      changed++;
      if (APPLY) {
        await prisma.deal.update({
          where: { id: deal.id },
          data: { amount: excelAmount },
        });
      }
    }
  }

  if (unmatchedExamples.length > 0) {
    console.log('Unmatched deal titles (first 10):');
    for (const ex of unmatchedExamples) console.log(`  ${ex}`);
    console.log('');
  }

  console.log('='.repeat(70));
  console.log('RESULT');
  console.log('='.repeat(70));
  console.log(`  Deals matched to Excel:      ${matched}`);
  console.log(`  Deals unmatched:             ${unmatched}`);
  console.log(`  Deals with changed amount:   ${changed}`);
  console.log(`  Old SUM(amount):             ${totalOldAmount.toLocaleString('ru-RU')}`);
  console.log(`  New SUM(amount):             ${totalNewAmount.toLocaleString('ru-RU')}`);
  console.log(`  Difference:                  ${(totalOldAmount - totalNewAmount).toLocaleString('ru-RU')}`);

  if (!APPLY) console.log('\n*** DRY RUN — run with --apply to execute ***');
}

main().catch(console.error).finally(() => prisma.$disconnect());
