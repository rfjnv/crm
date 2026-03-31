/**
 * Check Debt Gap: Excel closing balances vs CRM gross debt per client.
 *
 * 1. Reads 03.03.2026.xlsx — for each client, gets closing balance from the
 *    LATEST month sheet they appear in. Uses dynamic column detection:
 *    closingCol = totalCols - 2. Sums closing balance per client within each
 *    sheet (same client can have multiple rows). Latest month overwrites earlier.
 *
 * 2. Queries CRM DB for per-client gross debt:
 *    SUM(GREATEST(d.amount - d.paid_amount, 0)) grouped by client.
 *
 * 3. Matches by normalized name; computes gap = crm_gross - MAX(excel_closing, 0).
 *
 * 4. Prints table sorted by gap DESC, only where gap > 100,000.
 *
 * 5. Prints total gap sum (should approximate 287M).
 *
 * 6. Computes the "in-Excel gap": SUM of CRM gross debts where client has
 *    positive excel_closing vs SUM of those positive excel_closing values.
 *
 * Usage: npx tsx src/scripts/_check-debt-gap.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'path';

// ── Helpers ──────────────────────────────────────────────────────────

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n =
    typeof v === 'number'
      ? v
      : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function normName(s: string): string {
  return s.trim().toLowerCase();
}

// ── Month ordering ───────────────────────────────────────────────────

const MONTH_ORDER: Record<string, number> = {
  'январь': 1,
  'февраль': 2,
  'март': 3,
  'апрель': 4,
  'май': 5,
  'июнь': 6,
  'июль': 7,
  'август': 8,
  'сентябрь': 9,
  'октябрь': 10,
  'ноябрь': 11,
  'декабрь': 12,
};

function sheetToMonthKey(sheetName: string): number {
  const parts = sheetName.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return 0;
  const monthNum = MONTH_ORDER[parts[0]];
  const year = parseInt(parts[1], 10);
  if (!monthNum || isNaN(year)) return 0;
  return year * 100 + monthNum;
}

function getClosingBalanceCol(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref'];
  if (!ref) return 26;
  const range = XLSX.utils.decode_range(ref);
  const totalCols = range.e.c + 1;
  return totalCols - 2;
}

// ── Excel parsing ────────────────────────────────────────────────────

interface ExcelEntry {
  rawName: string;
  closingBalance: number;   // summed across rows within the latest sheet
  sheet: string;
  monthKey: number;
}

/**
 * Parse a single Excel file. For each sheet (month), sum closing balances
 * per client (same client can appear in multiple rows). The latest month
 * overwrites earlier months for each client.
 */
function parseExcelFile(
  fpath: string,
  result: Map<string, ExcelEntry>,
): void {
  const wb = XLSX.readFile(fpath);
  console.log(`  Sheets: ${wb.SheetNames.join(', ')}`);

  // Process sheets in order so latest month wins
  const sheetsWithKeys = wb.SheetNames
    .map((name) => ({ name, key: sheetToMonthKey(name) }))
    .filter((s) => s.key > 0)
    .sort((a, b) => a.key - b.key);  // ascending so latest overwrites

  for (const { name: sheetName, key: monthKey } of sheetsWithKeys) {
    const ws = wb.Sheets[sheetName];
    const closingCol = getClosingBalanceCol(ws);
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    // Sum closing balance per client within this sheet
    const sheetAccum = new Map<string, { rawName: string; sum: number }>();

    for (let i = 3; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const rawName = String(row[1] || '').trim();
      if (!rawName) continue;

      const closing = numVal(row[closingCol]);
      const key = normName(rawName);

      const existing = sheetAccum.get(key);
      if (existing) {
        existing.sum += closing;
      } else {
        sheetAccum.set(key, { rawName, sum: closing });
      }
    }

    // Now write accumulated values — latest month overwrites earlier
    for (const [key, { rawName, sum }] of sheetAccum) {
      const prev = result.get(key);
      if (!prev || monthKey >= prev.monthKey) {
        result.set(key, {
          rawName,
          closingBalance: sum,
          sheet: sheetName,
          monthKey,
        });
      }
    }

    console.log(`    "${sheetName}" (key=${monthKey}): ${sheetAccum.size} clients, closingCol=${closingCol}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('============================================================');
  console.log('   DEBT GAP: Excel Closing Balances vs CRM Gross Debt');
  console.log('============================================================\n');

  // 1. Parse Excel ─────────────────────────────────────────────────────
  console.log('[1] Reading Excel file...');
  const excelPath = path.resolve('c:\\Users\\Noutbuk savdosi\\CRM\\03.03.2026.xlsx');
  const excelMap = new Map<string, ExcelEntry>();
  parseExcelFile(excelPath, excelMap);
  console.log(`\n  Unique clients in Excel (latest month per client): ${excelMap.size}\n`);

  // 2. Query CRM database ──────────────────────────────────────────────
  console.log('[2] Querying CRM database for gross debt per client...');
  const prisma = new PrismaClient();

  try {
    const crmRows = await prisma.$queryRaw<
      { id: string; company_name: string; gross_debt: string }[]
    >(
      Prisma.sql`
        SELECT c.id, c.company_name,
          SUM(GREATEST(d.amount - d.paid_amount, 0))::text as gross_debt
        FROM deals d
        JOIN clients c ON c.id = d.client_id
        WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        GROUP BY c.id, c.company_name
        HAVING SUM(GREATEST(d.amount - d.paid_amount, 0)) > 0
        ORDER BY SUM(GREATEST(d.amount - d.paid_amount, 0)) DESC
      `,
    );

    console.log(`  CRM clients with positive gross debt: ${crmRows.length}\n`);

    // 3. Match and compute gaps ─────────────────────────────────────────
    console.log('[3] Matching clients and computing gaps...\n');

    interface GapRow {
      companyName: string;
      crmGross: number;
      excelClosing: number;
      gap: number;
    }

    const gapRows: GapRow[] = [];
    let unmatchedCrmCount = 0;
    let unmatchedCrmDebt = 0;

    for (const crm of crmRows) {
      const key = normName(crm.company_name);
      const excel = excelMap.get(key);
      const crmGross = Number(crm.gross_debt);
      const excelClosing = excel?.closingBalance ?? 0;

      // gap = crm_gross - MAX(excel_closing, 0)
      // If excel closing is negative (overpaid), expected CRM debt = 0
      const gap = crmGross - Math.max(excelClosing, 0);

      if (!excel) {
        unmatchedCrmCount++;
        unmatchedCrmDebt += crmGross;
      }

      gapRows.push({
        companyName: crm.company_name.trim(),
        crmGross,
        excelClosing: excel ? excelClosing : NaN,  // NaN means no match
        gap,
      });
    }

    // 4. Print table: gap > 100,000, sorted by gap DESC ─────────────────
    const significant = gapRows
      .filter((r) => r.gap > 100_000)
      .sort((a, b) => b.gap - a.gap);

    const COL = { name: 40, num: 18 };
    const hdr =
      'Company'.padEnd(COL.name) +
      'CRM Gross'.padStart(COL.num) +
      'Excel Closing'.padStart(COL.num) +
      'Gap'.padStart(COL.num);
    const sep = '-'.repeat(hdr.length);

    console.log('=== SIGNIFICANT GAPS (gap > 100,000) sorted by gap DESC ===');
    console.log(sep);
    console.log(hdr);
    console.log(sep);

    let totalGap = 0;

    for (const r of significant) {
      const excelStr = isNaN(r.excelClosing) ? '(no match)' : fmt(r.excelClosing);
      console.log(
        r.companyName.substring(0, COL.name - 1).padEnd(COL.name) +
          fmt(r.crmGross).padStart(COL.num) +
          excelStr.padStart(COL.num) +
          fmt(r.gap).padStart(COL.num),
      );
      totalGap += r.gap;
    }

    console.log(sep);
    console.log(
      `TOTAL (${significant.length} clients)`.padEnd(COL.name) +
        ''.padStart(COL.num) +
        ''.padStart(COL.num) +
        fmt(totalGap).padStart(COL.num),
    );
    console.log(sep);

    // 5. Total gap sum across ALL clients ─────────────────────────────
    const grandTotalGap = gapRows.reduce((s, r) => s + r.gap, 0);
    console.log(`\n[5] TOTAL GAP (all clients): ${fmt(grandTotalGap)}`);
    console.log(`    Unmatched CRM clients: ${unmatchedCrmCount} (debt: ${fmt(unmatchedCrmDebt)})`);

    // 6. In-Excel gap: only clients matched AND with positive excel_closing
    const inExcel = gapRows.filter(
      (r) => !isNaN(r.excelClosing) && r.excelClosing > 0,
    );
    const sumCrmGrossInExcel = inExcel.reduce((s, r) => s + r.crmGross, 0);
    const sumExcelClosing = inExcel.reduce((s, r) => s + r.excelClosing, 0);
    const inExcelGap = sumCrmGrossInExcel - sumExcelClosing;

    console.log(`\n[6] IN-EXCEL GAP (clients matched with positive excel_closing):`);
    console.log(`    Clients:                 ${inExcel.length}`);
    console.log(`    SUM CRM gross debt:      ${fmt(sumCrmGrossInExcel)}`);
    console.log(`    SUM Excel closing:       ${fmt(sumExcelClosing)}`);
    console.log(`    In-Excel gap (diff):     ${fmt(inExcelGap)}`);
    console.log('============================================================\n');

    await prisma.$disconnect();
  } catch (err) {
    await prisma.$disconnect();
    throw err;
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
