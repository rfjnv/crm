/**
 * Phase 5: Final sync — match per-client closing balance from Excel,
 * create adjustment payments via FIFO or reduce paidAmount via LIFO.
 *
 * This is essentially a cleaned-up version of sync-payments.ts.
 * It reads the last sheet of 07.03.2026.xlsx and reconciles each client.
 *
 * Run:
 *   cd backend && npx tsx src/scripts/rebuild/phase5-sync.ts            # dry-run
 *   cd backend && npx tsx src/scripts/rebuild/phase5-sync.ts --apply    # live
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../../lib/normalize-client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const DEBT_MARKS = new Set(['к', 'н/к', 'п/к', 'ф']);
const PREPAY_MARKS = new Set(['пп']);
const SYNC_MARKS = new Set([...DEBT_MARKS, ...PREPAY_MARKS]);
const NKP_COL = 9;

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

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

function getClosingBalanceCol(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref'];
  if (!ref) return 26;
  const range = XLSX.utils.decode_range(ref);
  return range.e.c + 1 - 2;
}

/** Parse closing balances from last sheet of 10.03.2026.xlsx */
function parseExcelClosing(): { clientMap: Map<string, number>; monthIdx: number; year: number } {
  const fpath = path.resolve(process.cwd(), '..', '10.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const sn = sheetName.toLowerCase().trim();

  let monthIdx = -1;
  for (let m = 0; m < MONTH_NAMES.length; m++) {
    if (sn.startsWith(MONTH_NAMES[m])) { monthIdx = m; break; }
  }
  const yearMatch = sheetName.match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : 2026;

  const ws = wb.Sheets[sheetName];
  const closingCol = getClosingBalanceCol(ws);
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];

  console.log(`  Sheet: "${sheetName}", closingCol=${closingCol}, rows=${data.length}`);

  // Collect per-client: total closing balance + whether they have a sync mark
  const clientRows = new Map<string, { total: number; hasSyncMark: boolean }>();

  for (let i = 3; i < data.length; i++) {
    const row = data[i] as Row;
    if (!row) continue;
    const clientName = normalizeClientName(row[1]);
    if (!clientName) continue;

    const nkp = norm(row[NKP_COL]).toLowerCase();
    const closing = numVal(row[closingCol]);

    const entry = clientRows.get(clientName) || { total: 0, hasSyncMark: false };
    entry.total += closing;
    if (SYNC_MARKS.has(nkp)) entry.hasSyncMark = true;
    clientRows.set(clientName, entry);
  }

  // Only keep clients with at least one sync mark
  const clientMap = new Map<string, number>();
  for (const [name, entry] of clientRows) {
    if (entry.hasSyncMark) clientMap.set(name, entry.total);
  }

  console.log(`  Sync clients: ${clientMap.size}`);
  return { clientMap, monthIdx, year };
}

/** Match Excel clients to CRM */
async function matchClients(excelClients: Map<string, number>) {
  const crmClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const crmNorm = new Map<string, { id: string; name: string }>();
  for (const c of crmClients) {
    crmNorm.set(normalizeClientName(c.companyName), { id: c.id, name: c.companyName });
  }

  const matched = new Map<string, { clientId: string; crmName: string; excelClosing: number }>();
  const unmatched: string[] = [];

  for (const [excelKey, closing] of excelClients) {
    if (crmNorm.has(excelKey)) {
      const crm = crmNorm.get(excelKey)!;
      matched.set(excelKey, { clientId: crm.id, crmName: crm.name, excelClosing: closing });
    } else {
      // prefix match
      let found = false;
      for (const [crmKey, crmVal] of crmNorm) {
        if ((crmKey.startsWith(excelKey) || excelKey.startsWith(crmKey)) && Math.min(excelKey.length, crmKey.length) >= 3) {
          matched.set(excelKey, { clientId: crmVal.id, crmName: crmVal.name, excelClosing: closing });
          found = true;
          break;
        }
      }
      if (!found) unmatched.push(excelKey);
    }
  }

  return { matched, unmatched };
}

/** Get CRM per-client net debt */
async function getCrmDebts(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ client_id: string; net: string }[]>(Prisma.sql`
    SELECT d.client_id, COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
    FROM deals d
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
    GROUP BY d.client_id
  `);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.client_id, Number(r.net));
  return map;
}

/** FIFO allocate payment to oldest unpaid deals */
async function fifoAllocate(clientId: string, amount: number, paidAt: Date, note: string, adminId: string) {
  const deals = await prisma.deal.findMany({
    where: { clientId, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, paidAmount: true },
  });

  let remaining = amount;
  const ops: { dealId: string; payAmount: number; newPaid: number; newStatus: string }[] = [];

  for (const deal of deals) {
    if (remaining <= 0.01) break;
    const gap = Math.max(Number(deal.amount) - Number(deal.paidAmount), 0);
    if (gap <= 0) continue;
    const alloc = Math.round(Math.min(remaining, gap) * 100) / 100;
    const newPaid = Math.round((Number(deal.paidAmount) + alloc) * 100) / 100;
    ops.push({
      dealId: deal.id,
      payAmount: alloc,
      newPaid,
      newStatus: computePaymentStatus(newPaid, Number(deal.amount)),
    });
    remaining -= alloc;
  }

  // Overflow goes to last deal
  if (remaining > 0.01 && deals.length > 0) {
    const last = deals[deals.length - 1];
    const existing = ops.find(o => o.dealId === last.id);
    if (existing) {
      existing.payAmount += remaining;
      existing.newPaid = Math.round((existing.newPaid + remaining) * 100) / 100;
      existing.newStatus = computePaymentStatus(existing.newPaid, Number(last.amount));
    } else {
      ops.push({
        dealId: last.id,
        payAmount: Math.round(remaining * 100) / 100,
        newPaid: Math.round((Number(last.paidAmount) + remaining) * 100) / 100,
        newStatus: computePaymentStatus(Number(last.paidAmount) + remaining, Number(last.amount)),
      });
    }
  }

  if (APPLY) {
    await prisma.$transaction(async (tx) => {
      for (const op of ops) {
        await tx.payment.create({
          data: {
            dealId: op.dealId, clientId, amount: op.payAmount,
            method: 'TRANSFER', paidAt, createdBy: adminId, note, createdAt: paidAt,
          },
        });
        await tx.deal.update({
          where: { id: op.dealId },
          data: { paidAmount: op.newPaid, paymentStatus: op.newStatus as any },
        });
      }
    }, { maxWait: 30000, timeout: 60000 });
  }

  return ops.length;
}

/** LIFO reduce paidAmount on newest deals */
async function lifoReduce(clientId: string, excess: number) {
  const deals = await prisma.deal.findMany({
    where: { clientId, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, paidAmount: true },
  });

  let remaining = excess;
  const ops: { dealId: string; newPaid: number; newStatus: string }[] = [];

  for (const deal of deals) {
    if (remaining <= 0.01) break;
    const currentPaid = Number(deal.paidAmount);
    if (currentPaid <= 0) continue;
    const reduce = Math.min(remaining, currentPaid);
    const newPaid = Math.round((currentPaid - reduce) * 100) / 100;
    ops.push({
      dealId: deal.id, newPaid,
      newStatus: computePaymentStatus(newPaid, Number(deal.amount)),
    });
    remaining -= reduce;
  }

  if (APPLY) {
    await prisma.$transaction(async (tx) => {
      for (const op of ops) {
        await tx.deal.update({
          where: { id: op.dealId },
          data: { paidAmount: op.newPaid, paymentStatus: op.newStatus as any },
        });
      }
    }, { maxWait: 30000, timeout: 60000 });
  }

  return ops.length;
}

async function main() {
  console.log(`=== Phase 5: FINAL SYNC ${APPLY ? '*** APPLY ***' : '(dry-run)'} ===\n`);

  const adminUser = await prisma.user.findFirst({
    where: { OR: [{ login: 'admin' }, { role: 'SUPER_ADMIN' }] },
    select: { id: true },
  });
  if (!adminUser) { console.error('No admin user found'); process.exit(1); }

  // 1. Parse Excel
  console.log('[1/4] Parsing Excel closing balances...');
  const { clientMap: excelClosing, monthIdx, year } = parseExcelClosing();

  let totalExcel = 0;
  for (const [, v] of excelClosing) totalExcel += v;
  console.log(`  Total Excel closing: ${fmtNum(totalExcel)}\n`);

  // 2. Match clients
  console.log('[2/4] Matching clients...');
  const { matched, unmatched } = await matchClients(excelClosing);
  console.log(`  Matched: ${matched.size}, Unmatched: ${unmatched.length}\n`);

  // 3. Get CRM debts
  console.log('[3/4] Loading CRM debts...');
  const crmDebts = await getCrmDebts();

  // 4. Reconcile
  console.log('[4/4] Reconciling...\n');

  const paidAt = new Date(Date.UTC(year, monthIdx + 1, 0)); // last day of month
  const note = `Сверка Phase5: ${MONTH_NAMES_RU[monthIdx]} ${year}`;

  let clientsAdjusted = 0;
  let clientsOk = 0;
  let totalGapPositive = 0;
  let totalGapNegative = 0;
  const bigGaps: { name: string; crmDebt: number; excel: number; gap: number }[] = [];

  for (const [, m] of matched) {
    const crmDebt = crmDebts.get(m.clientId) || 0;
    const gap = crmDebt - m.excelClosing;

    if (Math.abs(gap) < 1) { clientsOk++; continue; }

    clientsAdjusted++;

    if (gap > 0) {
      totalGapPositive += gap;
      await fifoAllocate(m.clientId, gap, paidAt, note, adminUser.id);
    } else {
      totalGapNegative += Math.abs(gap);
      await lifoReduce(m.clientId, Math.abs(gap));
    }

    if (Math.abs(gap) > 1_000_000) {
      bigGaps.push({ name: m.crmName, crmDebt, excel: m.excelClosing, gap });
    }
  }

  // Show big gaps
  if (bigGaps.length > 0) {
    bigGaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    console.log('Biggest adjustments (>1M):');
    for (const g of bigGaps.slice(0, 20)) {
      console.log(`  ${g.name.padEnd(30)} CRM=${fmtNum(g.crmDebt).padStart(15)} Excel=${fmtNum(g.excel).padStart(15)} Gap=${fmtNum(g.gap)}`);
    }
    console.log('');
  }

  // Verify
  const postDebt = await prisma.$queryRaw<{ gross: string; prepay: string }[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
      COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as prepay
    FROM deals d
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
  `);

  const gross = Number(postDebt[0].gross);
  const prepay = Number(postDebt[0].prepay);

  console.log('='.repeat(70));
  console.log('RESULT');
  console.log('='.repeat(70));
  console.log(`  Clients OK (no gap):    ${clientsOk}`);
  console.log(`  Clients adjusted:       ${clientsAdjusted}`);
  console.log(`  Gap closed (payments):  ${fmtNum(totalGapPositive)}`);
  console.log(`  Gap closed (reduced):   ${fmtNum(totalGapNegative)}`);
  console.log(`  ────────────────────────`);
  console.log(`  Gross debt:             ${fmtNum(gross)}`);
  console.log(`  Prepayments:            ${fmtNum(prepay)}`);
  console.log(`  Net debt:               ${fmtNum(gross - prepay)}`);
  console.log(`  ────────────────────────`);
  console.log(`  Excel target:`);
  console.log(`    Gross debt:           1,221,993,663`);
  console.log(`    Prepayments:          241,058,500`);
  console.log(`    Net debt:             983,502,063`);

  if (!APPLY) console.log('\n*** DRY RUN — run with --apply to execute ***');
}

main().catch(console.error).finally(() => prisma.$disconnect());
