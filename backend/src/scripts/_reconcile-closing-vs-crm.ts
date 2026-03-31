/**
 * Reconciliation: Excel closing balances vs CRM debt per client.
 *
 * Reads two Excel files (29.12.2025.xlsx and 03.03.2026.xlsx),
 * extracts closing balance per client from each sheet (month),
 * keeps only the LATEST month's closing balance per client,
 * then compares with CRM gross/net debt.
 *
 * Usage: npx tsx src/scripts/_reconcile-closing-vs-crm.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import fs from 'fs';
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

/** Format number with thousand separators and 2 decimals */
function fmt(n: number): string {
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Closing balance column = total_columns - 2 */
function getClosingBalanceCol(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref'];
  if (!ref) return 26;
  const range = XLSX.utils.decode_range(ref);
  const totalCols = range.e.c + 1;
  return totalCols - 2;
}

/** Normalize client name for matching */
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

/**
 * Parse a sheet name like "январь 2026" or "декабрь 2025" into a
 * sortable numeric key YYYYMM (e.g. 202601, 202512).
 * Returns 0 if unparseable.
 */
function sheetToMonthKey(sheetName: string): number {
  const parts = sheetName.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return 0;
  const monthNum = MONTH_ORDER[parts[0]];
  const year = parseInt(parts[1], 10);
  if (!monthNum || isNaN(year)) return 0;
  return year * 100 + monthNum;
}

// ── Excel parsing ────────────────────────────────────────────────────

interface ExcelEntry {
  rawName: string;       // original casing
  closingBalance: number;
  sheet: string;
  file: string;
  monthKey: number;      // YYYYMM
}

function parseExcelFile(
  fpath: string,
  fname: string,
  result: Map<string, ExcelEntry>,
): void {
  if (!fs.existsSync(fpath)) {
    console.log(`  [skip] File not found: ${fpath}`);
    return;
  }
  const wb = XLSX.readFile(fpath);
  console.log(`  [ok]   ${fname}  sheets: ${wb.SheetNames.join(', ')}`);

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.toLowerCase().trim();
    if (sn === 'лист1' || sn === 'лист2' || sn === 'sheet1') continue;

    const monthKey = sheetToMonthKey(sheetName);
    if (monthKey === 0) {
      console.log(`         -> skipping sheet "${sheetName}" (unrecognized month)`);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    const closingCol = getClosingBalanceCol(ws);
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    let clientsInSheet = 0;
    for (let i = 3; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const rawName = String(row[1] || '').trim();
      if (!rawName) continue;

      const closing = numVal(row[closingCol]);
      const key = normName(rawName);

      const existing = result.get(key);
      // Keep only the latest month per client
      if (!existing || monthKey > existing.monthKey) {
        result.set(key, {
          rawName,
          closingBalance: closing,
          sheet: sheetName,
          file: fname,
          monthKey,
        });
      }
      clientsInSheet++;
    }
    console.log(`         -> "${sheetName}" (key=${monthKey}): ${clientsInSheet} clients, closingCol=${closingCol}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const DB_URL =
  'postgresql://crm_user:BChpe9Gb4dOeVQQxRYVkiLUgu4TsmWJo@dpg-d6bcdrt6ubrc73ch10dg-a.oregon-postgres.render.com/crm_db_okj8';

async function main() {
  console.log('============================================================');
  console.log('   RECONCILIATION: Excel Closing Balances vs CRM Debt');
  console.log('============================================================\n');

  // 1. Parse Excel files -----------------------------------------------
  console.log('[1] Reading Excel files...');
  const excelMap = new Map<string, ExcelEntry>();

  const files = [
    { name: '29.12.2025.xlsx', path: path.resolve('c:\\Users\\Noutbuk savdosi\\CRM\\29.12.2025.xlsx') },
    { name: '03.03.2026.xlsx', path: path.resolve('c:\\Users\\Noutbuk savdosi\\CRM\\03.03.2026.xlsx') },
  ];

  for (const f of files) {
    parseExcelFile(f.path, f.name, excelMap);
  }

  console.log(`\n    Total unique clients in Excel (latest month per client): ${excelMap.size}`);

  // 2. Query CRM database ---------------------------------------------
  console.log('\n[2] Querying CRM database...');
  const prisma = new PrismaClient({
    datasources: { db: { url: DB_URL } },
  });

  try {
    const crmRows = await prisma.$queryRaw<
      {
        company_name: string;
        gross_debt: string;
        net_debt: string;
        deal_count: string;
      }[]
    >(
      Prisma.sql`
        SELECT
          c.company_name,
          COALESCE(SUM(GREATEST(d.amount - COALESCE(d.paid_amount, 0), 0)), 0)::text AS gross_debt,
          COALESCE(SUM(d.amount - COALESCE(d.paid_amount, 0)), 0)::text                AS net_debt,
          COUNT(d.id)::text                                                              AS deal_count
        FROM clients c
        JOIN deals d ON d.client_id = c.id
        WHERE d.is_archived = false
          AND d.status NOT IN ('CANCELED', 'REJECTED')
        GROUP BY c.id, c.company_name
        ORDER BY c.company_name
      `,
    );

    console.log(`    CRM clients with active deals: ${crmRows.length}`);

    // 3. Build reconciliation table ------------------------------------
    console.log('\n[3] Building reconciliation...\n');

    interface ReconRow {
      clientName: string;
      excelClosing: number;
      crmGross: number;
      crmNet: number;
      diff: number;         // CRM net - Excel closing
      source: string;       // "both" | "excel_only" | "crm_only"
      excelSheet: string;
      dealCount: number;
    }

    const reconRows: ReconRow[] = [];
    const matchedExcelKeys = new Set<string>();

    for (const crm of crmRows) {
      const key = normName(crm.company_name);
      const excel = excelMap.get(key);
      const crmGross = Number(crm.gross_debt);
      const crmNet = Number(crm.net_debt);
      const excelClosing = excel?.closingBalance ?? 0;

      if (excel) matchedExcelKeys.add(key);

      reconRows.push({
        clientName: crm.company_name.trim(),
        excelClosing,
        crmGross,
        crmNet,
        diff: crmNet - excelClosing,
        source: excel ? 'both' : 'crm_only',
        excelSheet: excel ? `${excel.file} / ${excel.sheet}` : '',
        dealCount: Number(crm.deal_count),
      });
    }

    // Excel-only clients
    for (const [key, entry] of excelMap) {
      if (!matchedExcelKeys.has(key)) {
        reconRows.push({
          clientName: entry.rawName,
          excelClosing: entry.closingBalance,
          crmGross: 0,
          crmNet: 0,
          diff: 0 - entry.closingBalance,
          source: 'excel_only',
          excelSheet: `${entry.file} / ${entry.sheet}`,
          dealCount: 0,
        });
      }
    }

    // 4. Print matched table ------------------------------------------
    const matched = reconRows.filter((r) => r.source === 'both');
    const crmOnly = reconRows.filter((r) => r.source === 'crm_only');
    const excelOnly = reconRows.filter((r) => r.source === 'excel_only');

    const COL = {
      name: 38,
      num: 18,
    };

    const hdr =
      'Client'.padEnd(COL.name) +
      'Excel Closing'.padStart(COL.num) +
      'CRM Gross'.padStart(COL.num) +
      'CRM Net'.padStart(COL.num) +
      'Diff(Net-Exc)'.padStart(COL.num);
    const sep = '-'.repeat(hdr.length);

    // ---- MATCHED (both in Excel and CRM) ----
    console.log('=== MATCHED CLIENTS (in both Excel and CRM) ===');
    console.log(sep);
    console.log(hdr);
    console.log(sep);

    let totExcel = 0,
      totGross = 0,
      totNet = 0,
      totDiff = 0;

    // Sort matched by absolute diff descending so biggest discrepancies are at top
    matched.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    for (const r of matched) {
      totExcel += r.excelClosing;
      totGross += r.crmGross;
      totNet += r.crmNet;
      totDiff += r.diff;

      console.log(
        r.clientName.substring(0, COL.name - 1).padEnd(COL.name) +
          fmt(r.excelClosing).padStart(COL.num) +
          fmt(r.crmGross).padStart(COL.num) +
          fmt(r.crmNet).padStart(COL.num) +
          fmt(r.diff).padStart(COL.num),
      );
    }

    console.log(sep);
    console.log(
      'TOTALS (matched)'.padEnd(COL.name) +
        fmt(totExcel).padStart(COL.num) +
        fmt(totGross).padStart(COL.num) +
        fmt(totNet).padStart(COL.num) +
        fmt(totDiff).padStart(COL.num),
    );
    console.log(sep);
    console.log(`Matched clients: ${matched.length}\n`);

    // ---- CRM ONLY ----
    if (crmOnly.length > 0) {
      console.log('=== CRM-ONLY CLIENTS (not found in Excel) ===');
      const crmOnlyHdr =
        'Client'.padEnd(COL.name) +
        'CRM Gross'.padStart(COL.num) +
        'CRM Net'.padStart(COL.num) +
        'Deals'.padStart(8);
      console.log('-'.repeat(crmOnlyHdr.length));
      console.log(crmOnlyHdr);
      console.log('-'.repeat(crmOnlyHdr.length));

      let crmOnlyGross = 0, crmOnlyNet = 0;
      // Sort by gross debt descending
      crmOnly.sort((a, b) => b.crmGross - a.crmGross);

      for (const r of crmOnly) {
        crmOnlyGross += r.crmGross;
        crmOnlyNet += r.crmNet;
        console.log(
          r.clientName.substring(0, COL.name - 1).padEnd(COL.name) +
            fmt(r.crmGross).padStart(COL.num) +
            fmt(r.crmNet).padStart(COL.num) +
            String(r.dealCount).padStart(8),
        );
      }
      console.log('-'.repeat(crmOnlyHdr.length));
      console.log(
        'TOTALS (CRM only)'.padEnd(COL.name) +
          fmt(crmOnlyGross).padStart(COL.num) +
          fmt(crmOnlyNet).padStart(COL.num) +
          ''.padStart(8),
      );
      console.log(`CRM-only clients: ${crmOnly.length}\n`);
    }

    // ---- EXCEL ONLY ----
    if (excelOnly.length > 0) {
      // filter out zero-balance excel-only
      const excelOnlyNonZero = excelOnly.filter((r) => Math.abs(r.excelClosing) > 0.01);
      if (excelOnlyNonZero.length > 0) {
        console.log('=== EXCEL-ONLY CLIENTS (not found in CRM, non-zero balance) ===');
        const exOnlyHdr =
          'Client'.padEnd(COL.name) +
          'Excel Closing'.padStart(COL.num) +
          'Sheet'.padStart(30);
        console.log('-'.repeat(exOnlyHdr.length));
        console.log(exOnlyHdr);
        console.log('-'.repeat(exOnlyHdr.length));

        let exOnlyTotal = 0;
        excelOnlyNonZero.sort((a, b) => b.excelClosing - a.excelClosing);

        for (const r of excelOnlyNonZero) {
          exOnlyTotal += r.excelClosing;
          console.log(
            r.clientName.substring(0, COL.name - 1).padEnd(COL.name) +
              fmt(r.excelClosing).padStart(COL.num) +
              r.excelSheet.padStart(30),
          );
        }
        console.log('-'.repeat(exOnlyHdr.length));
        console.log(
          'TOTALS (Excel only)'.padEnd(COL.name) +
            fmt(exOnlyTotal).padStart(COL.num),
        );
        console.log(`Excel-only clients (non-zero): ${excelOnlyNonZero.length}`);
      }

      const excelOnlyZero = excelOnly.filter((r) => Math.abs(r.excelClosing) <= 0.01);
      if (excelOnlyZero.length > 0) {
        console.log(`Excel-only clients (zero balance, not shown): ${excelOnlyZero.length}`);
      }
      console.log();
    }

    // 5. Grand totals --------------------------------------------------
    const grandExcel = reconRows.reduce((s, r) => s + r.excelClosing, 0);
    const grandGross = reconRows.reduce((s, r) => s + r.crmGross, 0);
    const grandNet = reconRows.reduce((s, r) => s + r.crmNet, 0);
    const grandDiff = reconRows.reduce((s, r) => s + r.diff, 0);

    console.log('============================================================');
    console.log('   GRAND TOTALS (all clients)');
    console.log('============================================================');
    console.log(`   Excel Closing Balance:  ${fmt(grandExcel).padStart(20)}`);
    console.log(`   CRM Gross Debt:         ${fmt(grandGross).padStart(20)}`);
    console.log(`   CRM Net Debt:           ${fmt(grandNet).padStart(20)}`);
    console.log(`   Diff (CRM Net - Excel): ${fmt(grandDiff).padStart(20)}`);
    console.log('------------------------------------------------------------');
    console.log(`   Matched:     ${matched.length}`);
    console.log(`   CRM only:    ${crmOnly.length}`);
    console.log(`   Excel only:  ${excelOnly.length}`);
    console.log(`   Total:       ${reconRows.length}`);
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
