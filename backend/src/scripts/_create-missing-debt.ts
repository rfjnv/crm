/**
 * Create missing debt for under-debt clients.
 *
 * For clients where CRM debt < Excel J-filtered debt:
 * - If client NOT in CRM → create client + deal
 * - If client in CRM but no active-debt deals → create deal
 *
 * Each deal is a "reconciliation debt" deal with the exact gap amount.
 *
 * Run:
 *   npx tsx src/scripts/_create-missing-debt.ts            # dry-run
 *   npx tsx src/scripts/_create-missing-debt.ts --execute   # live
 */
import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();
const isExecute = process.argv.includes('--execute');

const DEBT_TYPES = new Set(['к', 'н/к', 'п/к', 'ф']);
const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

type Row = unknown[];

// ─────────── Parse Excel with J filter ───────────

interface ExcelClientInfo {
  debt: number;
  originalName: string; // keep original name for creating new CRM clients
}

function parseExcelJFiltered(): Map<string, ExcelClientInfo> {
  const fpath = path.resolve(process.cwd(), '..', 'frontend', '05.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);

  const clientSheets = new Map<string, Map<number, { rows: Row[]; balCol: number; rawName: string }>>();

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.toLowerCase().trim();
    let monthIdx = -1;
    for (let m = 0; m < MONTH_NAMES.length; m++) {
      if (sn.startsWith(MONTH_NAMES[m])) { monthIdx = m; break; }
    }
    if (monthIdx < 0) continue;

    const yearMatch = sheetName.match(/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 2026;
    const monthKey = year * 12 + monthIdx;

    const ws = wb.Sheets[sheetName];
    const ref = ws['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const balCol = range.e.c - 1;

    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

    for (let i = 3; i < data.length; i++) {
      const row = data[i] as Row;
      if (!row) continue;
      const clientRaw = row[1];
      if (!clientRaw || String(clientRaw).trim() === '') continue;

      const clientName = normalizeClientName(clientRaw);
      if (!clientName) continue;

      if (!clientSheets.has(clientName)) clientSheets.set(clientName, new Map());
      const sheets = clientSheets.get(clientName)!;
      if (!sheets.has(monthKey)) sheets.set(monthKey, { rows: [], balCol, rawName: String(clientRaw).trim() });
      sheets.get(monthKey)!.rows.push(row);
    }
  }

  const result = new Map<string, ExcelClientInfo>();

  for (const [clientName, sheets] of clientSheets) {
    const latestKey = Math.max(...sheets.keys());
    const { rows, balCol, rawName } = sheets.get(latestKey)!;

    let total = 0;
    for (const row of rows) {
      const jVal = row[9];
      const jStr = jVal != null ? String(jVal).trim().toLowerCase() : '';
      if (!DEBT_TYPES.has(jStr)) continue;
      total += numVal(row[balCol]);
    }

    result.set(clientName, { debt: total, originalName: rawName });
  }

  return result;
}

// ─────────── Main ───────────

async function main() {
  console.log('='.repeat(80));
  console.log(`  CREATE MISSING DEBT  ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(80));

  // Parse Excel
  console.log('\n[1/4] Parsing Excel (J filter: к, н/к, п/к, ф)...');
  const excelData = parseExcelJFiltered();
  let excelTotal = 0;
  for (const [, info] of excelData) if (info.debt > 0) excelTotal += info.debt;
  console.log(`  Excel target total: ${fmtNum(excelTotal)}`);

  // Build CRM client lookup
  console.log('\n[2/4] Loading CRM clients and debts...');
  const allClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const crmNormToClient = new Map<string, { id: string; name: string }>();
  for (const c of allClients) {
    const norm = normalizeClientName(c.companyName);
    crmNormToClient.set(norm, { id: c.id, name: c.companyName });
  }

  // Get CRM debts per client
  const deals = await prisma.deal.findMany({
    where: {
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    },
    select: { clientId: true, amount: true, paidAmount: true, paymentStatus: true },
  });

  const crmDebtByClient = new Map<string, number>();
  for (const d of deals) {
    if (d.paymentStatus === 'UNPAID' || d.paymentStatus === 'PARTIAL') {
      const debt = Number(d.amount) - Number(d.paidAmount);
      if (debt > 0) {
        crmDebtByClient.set(d.clientId, (crmDebtByClient.get(d.clientId) || 0) + debt);
      }
    }
  }

  // Get a default manager (first admin or any user)
  const defaultManager = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  }) || await prisma.user.findFirst({ select: { id: true } });

  if (!defaultManager) {
    console.error('ERROR: No users found in database');
    return;
  }

  // Find under-debt clients
  console.log('\n[3/4] Finding under-debt clients...\n');

  interface FixRow {
    normName: string;
    displayName: string;
    crmDebt: number;
    excelDebt: number;
    gap: number;
    action: string;
    status: string;
  }

  const rows: FixRow[] = [];
  let totalGap = 0;

  for (const [normName, excelInfo] of excelData) {
    if (excelInfo.debt <= 0) continue;

    const crmClient = crmNormToClient.get(normName);
    const crmDebt = crmClient ? (crmDebtByClient.get(crmClient.id) || 0) : 0;
    const gap = excelInfo.debt - crmDebt;

    if (gap < 1) continue;

    totalGap += gap;

    let action = '';
    if (!crmClient) {
      action = 'CREATE_CLIENT+DEAL';
    } else {
      action = 'CREATE_DEAL';
    }

    rows.push({
      normName,
      displayName: crmClient ? crmClient.name : excelInfo.originalName,
      crmDebt,
      excelDebt: excelInfo.debt,
      gap,
      action,
      status: 'PENDING',
    });
  }

  rows.sort((a, b) => b.gap - a.gap);

  // Print plan
  console.log(`${'Клиент'.padEnd(35)} ${'CRM'.padStart(14)} ${'Excel'.padStart(14)} ${'Нехватка'.padStart(14)} ${'Действие'.padEnd(22)} ${'Статус'.padStart(8)}`);
  console.log('─'.repeat(110));

  if (!isExecute) {
    for (const r of rows) {
      console.log(
        `${r.displayName.substring(0, 35).padEnd(35)} ${fmtNum(r.crmDebt).padStart(14)} ${fmtNum(r.excelDebt).padStart(14)} ${fmtNum(r.gap).padStart(14)} ${r.action.padEnd(22)} ${'WILL_FIX'.padStart(8)}`
      );
    }
  } else {
    // Execute
    console.log('\n[4/4] Creating missing debt...\n');

    for (const r of rows) {
      try {
        let clientId: string;

        if (!crmNormToClient.has(r.normName)) {
          // Create new client
          const newClient = await prisma.client.create({
            data: {
              companyName: r.displayName,
              contactName: r.displayName,
              managerId: defaultManager.id,
            },
          });
          clientId = newClient.id;
          console.log(`  Created client: ${r.displayName} (${newClient.id})`);
        } else {
          clientId = crmNormToClient.get(r.normName)!.id;
        }

        // Create deal with exact gap as debt
        const newDeal = await prisma.deal.create({
          data: {
            title: `Сверка: долг по Excel (${r.displayName})`,
            status: 'CLOSED',
            amount: Math.round(r.gap * 100) / 100,
            paidAmount: 0,
            paymentStatus: 'UNPAID',
            clientId,
            managerId: defaultManager.id,
          },
        });

        r.status = 'FIXED';
        console.log(
          `${r.displayName.substring(0, 35).padEnd(35)} ${fmtNum(r.crmDebt).padStart(14)} ${fmtNum(r.excelDebt).padStart(14)} ${fmtNum(r.gap).padStart(14)} ${r.action.padEnd(22)} ${'FIXED'.padStart(8)}`
        );
      } catch (err) {
        r.status = 'ERROR';
        console.error(`  ERROR [${r.displayName}]: ${(err as Error).message.slice(0, 100)}`);
        console.log(
          `${r.displayName.substring(0, 35).padEnd(35)} ${fmtNum(r.crmDebt).padStart(14)} ${fmtNum(r.excelDebt).padStart(14)} ${fmtNum(r.gap).padStart(14)} ${r.action.padEnd(22)} ${'ERROR'.padStart(8)}`
        );
      }
    }
  }

  // Verify
  const postDeals = await prisma.deal.findMany({
    where: {
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    },
    select: { amount: true, paidAmount: true },
  });
  let postTotal = 0;
  for (const d of postDeals) {
    const debt = Number(d.amount) - Number(d.paidAmount);
    if (debt > 0) postTotal += debt;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`  Clients to fix: ${rows.length}`);
  console.log(`  Total gap: ${fmtNum(totalGap)}`);
  console.log(`  CRM debt now: ${fmtNum(postTotal)}`);
  console.log(`  Excel target: ${fmtNum(excelTotal)}`);
  console.log(`  Difference: ${fmtNum(postTotal - excelTotal)}`);

  if (isExecute) {
    console.log(`\n  DONE: ${rows.filter(r => r.status === 'FIXED').length} clients fixed`);
  } else {
    console.log('\n  DRY-RUN. Use --execute to apply.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
