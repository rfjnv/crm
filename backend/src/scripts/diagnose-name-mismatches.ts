/**
 * Diagnose client name mismatches between Excel files and CRM.
 *
 * Finds clients where:
 *   - The raw name in Excel differs from the raw name in CRM
 *   - But their normalized key (token-sorted, transliterated) matches
 *   - This causes CRM to show open debt that Excel shows as closed
 *
 * This script is READ-ONLY — no data is modified.
 *
 * Run:
 *   cd backend && npx tsx src/scripts/diagnose-name-mismatches.ts
 *   cd backend && npx tsx src/scripts/diagnose-name-mismatches.ts --csv
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

// ─────────── constants ───────────

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const EXCEL_FILES = [
  { name: '29.12.2025.xlsx', defaultYear: 2025 },
  { name: '03.03.2026.xlsx', defaultYear: 2026 },
];

// ─────────── helpers ───────────

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function normLower(s: unknown): string {
  return norm(s).toLowerCase();
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function getClosingBalanceCol(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref'];
  if (!ref) return 26;
  const range = XLSX.utils.decode_range(ref);
  return range.e.c + 1 - 2;
}

type Row = unknown[];

// ─────────── types ───────────

interface ExcelClientRaw {
  rawNames: Set<string>;         // all raw name variants seen in Excel
  closingBalance: number;        // latest closing balance
  latestYear: number;
  latestMonth: number;
  sheetName: string;
}

interface MismatchRow {
  normalizedKey: string;
  excelRawNames: string[];
  crmName: string;
  crmClientId: string;
  crmDebt: number;
  excelClosing: number;
  difference: number;
  wouldFix: boolean;
}

// ─────────── Step 1: Parse Excel — collect RAW and normalized names ───────────

function parseExcelClients(): Map<string, ExcelClientRaw> {
  // Key = normalizedClientName, Value = raw data
  const clientMap = new Map<string, ExcelClientRaw>();

  for (const file of EXCEL_FILES) {
    const fpath = path.resolve(process.cwd(), '..', file.name);
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.readFile(fpath);
    } catch {
      console.log(`  WARNING: Cannot open ${file.name}, skipping`);
      continue;
    }

    console.log(`  Reading ${file.name} (${wb.SheetNames.length} sheets)`);

    for (const sheetName of wb.SheetNames) {
      const sn = sheetName.toLowerCase().trim();
      if (sn === 'лист1' || sn === 'лист2') continue;

      let monthIdx = -1;
      for (let m = 0; m < MONTH_NAMES.length; m++) {
        if (sn.startsWith(MONTH_NAMES[m])) { monthIdx = m; break; }
      }
      if (monthIdx < 0) continue;

      const yearMatch = sheetName.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : file.defaultYear;
      const monthKey = year * 12 + monthIdx;

      const ws = wb.Sheets[sheetName];
      const closingCol = getClosingBalanceCol(ws);
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

      // Accumulate per-client within sheet (by normalized key)
      const sheetBalances = new Map<string, { rawNames: Set<string>; balance: number }>();

      for (let i = 3; i < data.length; i++) {
        const row = data[i] as Row;
        if (!row) continue;
        const rawName = norm(row[1]);
        if (!rawName) continue;

        const normKey = normalizeClientName(row[1]);
        if (!normKey) continue;

        const closing = numVal(row[closingCol]);

        if (!sheetBalances.has(normKey)) {
          sheetBalances.set(normKey, { rawNames: new Set(), balance: 0 });
        }
        const entry = sheetBalances.get(normKey)!;
        entry.rawNames.add(rawName);
        entry.balance += closing;
      }

      for (const [normKey, data] of sheetBalances) {
        const existing = clientMap.get(normKey);
        const existingKey = existing ? existing.latestYear * 12 + existing.latestMonth : -1;

        if (!existing || monthKey > existingKey) {
          const rawNames = existing ? new Set([...existing.rawNames, ...data.rawNames]) : data.rawNames;
          clientMap.set(normKey, {
            rawNames,
            closingBalance: data.balance,
            latestYear: year,
            latestMonth: monthIdx,
            sheetName,
          });
        } else if (existing) {
          // Still track all raw name variants even from older sheets
          for (const rn of data.rawNames) existing.rawNames.add(rn);
        }
      }
    }
  }

  return clientMap;
}

// ─────────── main ───────────

async function main() {
  console.log('='.repeat(90));
  console.log('  CLIENT NAME MISMATCH DIAGNOSTIC (READ-ONLY)');
  console.log('='.repeat(90));
  console.log('  This script does NOT modify any data.\n');

  // ── Step 1: Parse Excel ──
  console.log('[1/4] Parsing Excel files...');
  const excelClients = parseExcelClients();
  console.log(`  Excel clients (normalized): ${excelClients.size}\n`);

  // ── Step 2: Load CRM clients + debt ──
  console.log('[2/4] Loading CRM clients and debts...');
  const allCrmClients = await prisma.client.findMany({
    select: { id: true, companyName: true },
  });

  // Build CRM lookup: normalizedKey → {id, rawName}
  const crmByNorm = new Map<string, { id: string; rawName: string }>();
  for (const c of allCrmClients) {
    const normKey = normalizeClientName(c.companyName);
    crmByNorm.set(normKey, { id: c.id, rawName: c.companyName });
  }

  // Get CRM debts
  const debtRows = await prisma.$queryRaw<
    { client_id: string; company_name: string; net: string; gross_debt: string }[]
  >(
    Prisma.sql`
      SELECT
        c.id as client_id,
        c.company_name,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net,
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross_debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
      GROUP BY c.id, c.company_name
    `
  );
  const crmDebts = new Map<string, { net: number; grossDebt: number }>();
  for (const r of debtRows) {
    crmDebts.set(r.client_id, { net: Number(r.net), grossDebt: Number(r.gross_debt) });
  }
  console.log(`  CRM clients: ${allCrmClients.length}`);
  console.log(`  CRM clients with debt data: ${crmDebts.size}\n`);

  // ── Step 3: Find mismatches ──
  console.log('[3/4] Detecting name mismatches...\n');
  const mismatches: MismatchRow[] = [];
  let matchedSame = 0;
  let matchedDifferent = 0;
  let unmatchedExcel = 0;

  for (const [normKey, excelData] of excelClients) {
    const crm = crmByNorm.get(normKey);
    if (!crm) {
      unmatchedExcel++;
      continue;
    }

    const crmRawLower = normLower(crm.rawName);
    const excelRawNames = [...excelData.rawNames];

    // Check if any Excel raw name differs from CRM raw name
    const allSame = excelRawNames.every((rn) => normLower(rn) === crmRawLower);

    if (allSame) {
      matchedSame++;
      continue;
    }

    // Name mismatch found — they match only after normalization
    matchedDifferent++;

    const debt = crmDebts.get(crm.id);
    const crmDebt = debt ? debt.grossDebt : 0;
    const excelClosing = excelData.closingBalance;
    const difference = crmDebt - excelClosing;

    mismatches.push({
      normalizedKey: normKey,
      excelRawNames,
      crmName: crm.rawName,
      crmClientId: crm.id,
      crmDebt,
      excelClosing,
      difference,
      wouldFix: difference > 1,  // normalization would help close this debt gap
    });
  }

  // Sort: biggest difference first
  mismatches.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  // ── Step 4: Report ──
  console.log('[4/4] Results\n');

  console.log('='.repeat(120));
  console.log('  NAME MISMATCH REPORT — Clients whose Excel name != CRM name but normalize to same key');
  console.log('='.repeat(120));

  if (mismatches.length === 0) {
    console.log('\n  No name mismatches found. All matched names are identical.');
  } else {
    console.log(`\n  Found ${mismatches.length} clients with name discrepancies:\n`);
    console.log(
      `  ${'#'.padStart(3)} | ` +
      `${'Excel Name(s)'.padEnd(30)} | ` +
      `${'CRM Name'.padEnd(30)} | ` +
      `${'Normalized Key'.padEnd(25)} | ` +
      `${'CRM Debt'.padStart(16)} | ` +
      `${'Excel Close'.padStart(16)} | ` +
      `${'Difference'.padStart(16)} | ` +
      `${'Would Fix?'}`
    );
    console.log('  ' + '-'.repeat(165));

    for (let i = 0; i < mismatches.length; i++) {
      const m = mismatches[i];
      const excelNamesStr = m.excelRawNames.join(' / ');
      console.log(
        `  ${String(i + 1).padStart(3)} | ` +
        `${excelNamesStr.substring(0, 30).padEnd(30)} | ` +
        `${m.crmName.substring(0, 30).padEnd(30)} | ` +
        `${m.normalizedKey.substring(0, 25).padEnd(25)} | ` +
        `${fmtNum(m.crmDebt).padStart(16)} | ` +
        `${fmtNum(m.excelClosing).padStart(16)} | ` +
        `${fmtNum(m.difference).padStart(16)} | ` +
        `${m.wouldFix ? 'YES' : 'no'}`
      );
    }
  }

  // ── Proposed matching pairs ──
  const withFix = mismatches.filter((m) => m.wouldFix);
  if (withFix.length > 0) {
    console.log('\n\n' + '='.repeat(120));
    console.log('  PROPOSED MATCHING PAIRS — After normalization, these debts would reconcile correctly');
    console.log('='.repeat(120) + '\n');

    for (const m of withFix) {
      console.log(`  Client ID: ${m.crmClientId}`);
      console.log(`    CRM name:        "${m.crmName}"`);
      console.log(`    Excel name(s):   ${m.excelRawNames.map((n) => `"${n}"`).join(', ')}`);
      console.log(`    Normalized key:  "${m.normalizedKey}"`);
      console.log(`    CRM debt:        ${fmtNum(m.crmDebt)}`);
      console.log(`    Excel closing:   ${fmtNum(m.excelClosing)}`);
      console.log(`    Gap to close:    ${fmtNum(m.difference)}`);
      console.log(`    After sync:      Debt would reduce by ${fmtNum(m.difference)}`);
      console.log('');
    }
  }

  // ── Verification: what happens after normalization ──
  console.log('='.repeat(90));
  console.log('  VERIFICATION: WILL DEBTS CLOSE CORRECTLY?');
  console.log('='.repeat(90));

  const totalGapFixed = withFix.reduce((s, m) => s + m.difference, 0);
  const totalAffectedDebt = withFix.reduce((s, m) => s + m.crmDebt, 0);

  console.log(`\n  Clients with name mismatch (total):    ${mismatches.length}`);
  console.log(`  Clients where mismatch causes debt gap: ${withFix.length}`);
  console.log(`  Total debt gap caused by mismatches:    ${fmtNum(totalGapFixed)}`);
  console.log(`  Total affected CRM debt:               ${fmtNum(totalAffectedDebt)}`);
  console.log(`\n  After normalization is applied to sync-payments.ts:`);
  console.log(`    - These ${withFix.length} clients will be matched correctly`);
  console.log(`    - sync-payments will detect the gap and create reconciliation payments`);
  console.log(`    - Total gap of ${fmtNum(totalGapFixed)} would be closed`);
  console.log(`    - All reconciliation still requires --execute flag (safe by default)`);

  // ── Summary ──
  console.log('\n' + '='.repeat(90));
  console.log('  SUMMARY');
  console.log('='.repeat(90));
  console.log(`  Excel clients (normalized):     ${excelClients.size}`);
  console.log(`  Matched with identical name:     ${matchedSame}`);
  console.log(`  Matched via normalization ONLY:   ${matchedDifferent}`);
  console.log(`  Unmatched (Excel-only):          ${unmatchedExcel}`);
  console.log(`  Name mismatches with debt gap:   ${withFix.length}`);
  console.log(`  Total gap from name mismatches:  ${fmtNum(totalGapFixed)}`);
  console.log(`\n  NO DATA WAS MODIFIED. This is a read-only diagnostic.`);

  // ── CSV export ──
  if (process.argv.includes('--csv')) {
    const csvLines = [
      'client_name_excel,client_name_crm,normalized_name,client_id,crm_debt,excel_closing_balance,difference,would_fix',
      ...mismatches.map((m) =>
        `"${m.excelRawNames.join(' / ').replace(/"/g, '""')}","${m.crmName.replace(/"/g, '""')}","${m.normalizedKey}","${m.crmClientId}",${m.crmDebt},${m.excelClosing},${m.difference},${m.wouldFix}`
      ),
    ];
    const csvPath = path.resolve(process.cwd(), '..', `name-mismatch-report-${Date.now()}.csv`);
    fs.writeFileSync(csvPath, '\uFEFF' + csvLines.join('\n'), 'utf8');
    console.log(`\n  CSV report saved: ${csvPath}`);
  }
}

main()
  .catch((err) => {
    console.error('Diagnostic failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
