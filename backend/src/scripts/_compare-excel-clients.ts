/**
 * Compare client lists between Excel 2025 and Excel 2026.
 * Find clients that existed in 2025 but are missing from 2026.
 * Cross-reference with CRM database.
 *
 * Run: cd backend && npx tsx src/scripts/_compare-excel-clients.ts
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const FILE_2025 = path.resolve(__dirname, '../../../29.12.2025.xlsx');
const FILE_2026 = path.resolve(__dirname, '../../../03.03.2026.xlsx');

function norm(v: any): string {
  if (v == null) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

function normLower(v: string): string {
  return v.toLowerCase().trim().replace(/\s+/g, ' ');
}

function numVal(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function getClosingBalanceCol(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref'];
  if (!ref) return 26;
  const range = XLSX.utils.decode_range(ref);
  const totalCols = range.e.c + 1;
  return totalCols - 2;
}

interface ClientData {
  name: string;
  closingBalance: number;
  lastMonth: string;
  sheetIndex: number;
}

function extractClientsFromExcel(filePath: string): Map<string, ClientData> {
  const wb = XLSX.readFile(filePath);
  const clients = new Map<string, ClientData>();

  const MONTH_NAMES = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ];

  const sheetCount = Math.min(wb.SheetNames.length, 12);

  for (let m = 0; m < sheetCount; m++) {
    const sheetName = wb.SheetNames[m];
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;

    const closingCol = getClosingBalanceCol(ws);
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;

      const clientName = norm(row[1]);
      if (!clientName || clientName.length < 2) continue;

      // Skip header-like rows
      const lower = clientName.toLowerCase();
      if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого') continue;

      const closing = numVal(row[closingCol]);

      // Keep the latest month data for each client
      const existing = clients.get(normLower(clientName));
      if (!existing || m > existing.sheetIndex) {
        clients.set(normLower(clientName), {
          name: clientName,
          closingBalance: closing,
          lastMonth: MONTH_NAMES[m] || sheetName,
          sheetIndex: m,
        });
      }
    }
  }

  return clients;
}

function getAllClientNames(filePath: string): Set<string> {
  const wb = XLSX.readFile(filePath);
  const names = new Set<string>();

  const sheetCount = Math.min(wb.SheetNames.length, 12);

  for (let m = 0; m < sheetCount; m++) {
    const ws = wb.Sheets[wb.SheetNames[m]];
    if (!ws || !ws['!ref']) continue;

    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;

      const clientName = norm(row[1]);
      if (!clientName || clientName.length < 2) continue;

      const lower = clientName.toLowerCase();
      if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого') continue;

      names.add(normLower(clientName));
    }
  }

  return names;
}

async function main() {
  console.log('='.repeat(80));
  console.log('  EXCEL CLIENT COMPARISON: 2025 vs 2026');
  console.log('='.repeat(80));

  // 1. Extract clients from 2025 with closing balances
  console.log('\nReading 2025 Excel...');
  const clients2025 = extractClientsFromExcel(FILE_2025);
  console.log(`  Found ${clients2025.size} unique clients in 2025`);

  // 2. Get all client names from 2026
  console.log('Reading 2026 Excel...');
  const names2026 = getAllClientNames(FILE_2026);
  console.log(`  Found ${names2026.size} unique clients in 2026`);

  // 3. Find missing clients (in 2025 but not in 2026)
  const missing: ClientData[] = [];
  const present: ClientData[] = [];

  for (const [key, data] of clients2025) {
    // Check exact match first
    if (names2026.has(key)) {
      present.push(data);
      continue;
    }

    // Check fuzzy match (prefix/substring)
    let found = false;
    for (const name2026 of names2026) {
      if (name2026.startsWith(key) || key.startsWith(name2026)) {
        found = true;
        break;
      }
      // Also check if one contains the other (at least 5 chars)
      if (key.length >= 5 && name2026.includes(key)) { found = true; break; }
      if (name2026.length >= 5 && key.includes(name2026)) { found = true; break; }
    }

    if (found) {
      present.push(data);
    } else {
      missing.push(data);
    }
  }

  // Sort missing by closing balance (biggest first)
  missing.sort((a, b) => b.closingBalance - a.closingBalance);

  console.log(`\n  Clients in both files: ${present.length}`);
  console.log(`  Clients MISSING from 2026: ${missing.length}`);

  // 4. Cross-reference with CRM
  console.log('\nQuerying CRM database...\n');

  // Get all CRM clients with their debt
  const crmClients = await prisma.$queryRaw<
    { id: string; company_name: string; debt: string; paid_amount: string; deal_count: string; payments_2026: string }[]
  >(
    Prisma.sql`
      SELECT c.id, c.company_name,
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as debt,
        COALESCE(SUM(d.paid_amount), 0)::text as paid_amount,
        COUNT(d.id)::text as deal_count,
        COALESCE(p26.cnt, 0)::text as payments_2026
      FROM clients c
      LEFT JOIN deals d ON d.client_id = c.id AND d.is_archived = false
      LEFT JOIN (
        SELECT p.client_id, COUNT(*)::bigint as cnt
        FROM payments p
        WHERE p.paid_at >= '2025-12-31T19:00:00Z'
        GROUP BY p.client_id
      ) p26 ON p26.client_id = c.id
      GROUP BY c.id, c.company_name, p26.cnt
    `
  );

  // Build CRM lookup
  const crmMap = new Map<string, typeof crmClients[0]>();
  for (const c of crmClients) {
    crmMap.set(normLower(c.company_name), c);
  }

  // 5. Print results
  console.log('='.repeat(120));
  console.log('  MISSING CLIENTS (in Excel 2025, NOT in Excel 2026)');
  console.log('='.repeat(120));

  const hdr = [
    'Client'.padEnd(35),
    'Closing 2025'.padStart(15),
    'Last Month'.padEnd(12),
    'CRM Debt'.padStart(15),
    'CRM Deals'.padStart(10),
    'Payments 2026'.padStart(14),
    'Explanation',
  ].join(' | ');
  console.log(hdr);
  console.log('-'.repeat(140));

  let totalMissingDebt = 0;
  let totalMissingClosing = 0;

  for (const m of missing) {
    const key = normLower(m.name);

    // Try to find in CRM (exact, then fuzzy)
    let crmClient = crmMap.get(key);
    if (!crmClient) {
      // fuzzy: try prefix match
      for (const [crmKey, crmVal] of crmMap) {
        if (crmKey.startsWith(key) || key.startsWith(crmKey)) {
          crmClient = crmVal;
          break;
        }
        if (key.length >= 5 && crmKey.includes(key)) { crmClient = crmVal; break; }
        if (crmKey.length >= 5 && key.includes(crmKey)) { crmClient = crmVal; break; }
      }
    }

    const crmDebt = crmClient ? Number(crmClient.debt) : 0;
    const crmDeals = crmClient ? Number(crmClient.deal_count) : 0;
    const payments2026 = crmClient ? Number(crmClient.payments_2026) : 0;

    totalMissingDebt += crmDebt;
    totalMissingClosing += m.closingBalance;

    // Explanation
    let explanation = '';
    if (!crmClient) {
      explanation = 'NOT IN CRM';
    } else if (crmDebt === 0 && m.closingBalance === 0) {
      explanation = 'Fully paid, dropped';
    } else if (crmDebt === 0 && m.closingBalance > 0) {
      explanation = 'CRM shows paid, Excel had balance';
    } else if (m.closingBalance === 0 && crmDebt > 0) {
      explanation = 'Excel settled, CRM still has debt';
    } else if (payments2026 > 0) {
      explanation = `Active in CRM (${payments2026} payments in 2026)`;
    } else {
      explanation = 'Debt remains, no 2026 activity';
    }

    console.log([
      m.name.substring(0, 35).padEnd(35),
      m.closingBalance.toLocaleString().padStart(15),
      m.lastMonth.padEnd(12),
      crmDebt.toLocaleString().padStart(15),
      String(crmDeals).padStart(10),
      String(payments2026).padStart(14),
      explanation,
    ].join(' | '));
  }

  console.log('-'.repeat(140));
  console.log([
    'TOTAL'.padEnd(35),
    totalMissingClosing.toLocaleString().padStart(15),
    ''.padEnd(12),
    totalMissingDebt.toLocaleString().padStart(15),
    ''.padStart(10),
    ''.padStart(14),
    '',
  ].join(' | '));

  // 6. Also show clients ONLY in 2026 (new clients)
  console.log('\n\n' + '='.repeat(80));
  console.log('  NEW CLIENTS (in Excel 2026 but NOT in Excel 2025)');
  console.log('='.repeat(80));

  const names2025 = new Set(clients2025.keys());
  const newIn2026: string[] = [];

  for (const name of names2026) {
    if (names2025.has(name)) continue;
    // Fuzzy check
    let found = false;
    for (const n25 of names2025) {
      if (n25.startsWith(name) || name.startsWith(n25)) { found = true; break; }
      if (name.length >= 5 && n25.includes(name)) { found = true; break; }
      if (n25.length >= 5 && name.includes(n25)) { found = true; break; }
    }
    if (!found) newIn2026.push(name);
  }

  console.log(`\n  New clients in 2026: ${newIn2026.length}`);
  if (newIn2026.length > 0) {
    for (const name of newIn2026.sort()) {
      console.log(`    - ${name}`);
    }
  }

  // 7. Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Excel 2025 unique clients: ${clients2025.size}`);
  console.log(`  Excel 2026 unique clients: ${names2026.size}`);
  console.log(`  Clients in both: ${present.length}`);
  console.log(`  Missing from 2026: ${missing.length}`);
  console.log(`  New in 2026: ${newIn2026.length}`);
  console.log(`  Total closing balance of missing: ${totalMissingClosing.toLocaleString()}`);
  console.log(`  Total CRM debt of missing: ${totalMissingDebt.toLocaleString()}`);
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
