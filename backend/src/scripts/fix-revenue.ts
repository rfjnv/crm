/**
 * Revenue Fix Script: Delete Сверка payments + reimport missing from Excel
 *
 * What it does:
 *   1. Deletes all 95 "Сверка" payments (synthetic, wrong monthly distribution)
 *   2. Compares per-client per-month payments: CRM vs Excel
 *   3. Creates missing payment records where CRM < Excel
 *   4. Does NOT touch deal.paidAmount (it's already correct from Excel)
 *
 * Run:
 *   npx tsx src/scripts/fix-revenue.ts              # dry-run
 *   npx tsx src/scripts/fix-revenue.ts --execute    # apply changes
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

// ───────── Config ─────────

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'QR', 'PAYME', 'TERMINAL'] as const;

const EXCEL_FILES = [
  { name: 'analytics_2024-12-26.xlsx', defaultYear: 2024 },
  { name: 'analytics_2025-12-29.xlsx', defaultYear: 2025 },
  { name: 'analytics_2026-03-12.xlsx', defaultYear: 2026 },
];

// ───────── Helpers ─────────

type Row = unknown[];

function numVal(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function normLower(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

function getPaymentCols(ws: XLSX.WorkSheet, data: Row[]): { index: number; method: string }[] {
  // Check if shifted layout (extra "договор" column)
  const h1 = data[1] as Row | undefined;
  const isShifted = h1 ? normLower(h1[11]).includes('договор') : false;

  if (isShifted) {
    return [
      { index: 13, method: 'CASH' },
      { index: 16, method: 'TRANSFER' },
      { index: 19, method: 'QR' },
      { index: 22, method: 'PAYME' },
      { index: 25, method: 'TERMINAL' },
    ];
  }
  return [
    { index: 12, method: 'CASH' },
    { index: 15, method: 'TRANSFER' },
    { index: 18, method: 'QR' },
    { index: 21, method: 'PAYME' },
    { index: 24, method: 'TERMINAL' },
  ];
}

// ───────── Step 1: Parse Excel ─────────

interface ExcelPayment {
  amount: number;
  method: string;
  month: number;   // 1-based
  year: number;
}

// key: "clientKey|YYYY-MM"
type MonthlyExcelData = Map<string, {
  clientKey: string;
  rawName: string;
  month: number;
  year: number;
  payments: ExcelPayment[];
  totalPayments: number;
}>;

function parseExcel(): { monthly: MonthlyExcelData; clientTotals: Map<string, { rawName: string; total: number }> } {
  const monthly: MonthlyExcelData = new Map();
  const clientTotals = new Map<string, { rawName: string; total: number }>();
  const projectRoot = path.resolve(__dirname, '..', '..', '..');

  for (const file of EXCEL_FILES) {
    const fpath = path.join(projectRoot, file.name);
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
      for (let i = 0; i < MONTH_NAMES.length; i++) {
        if (sn.startsWith(MONTH_NAMES[i])) { monthIdx = i; break; }
      }
      if (monthIdx < 0) continue;
      const month = monthIdx + 1;

      const yearMatch = sheetName.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : file.defaultYear;

      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];
      const paymentCols = getPaymentCols(ws, data);

      let sheetPayments = 0;
      let sheetTotal = 0;

      for (let r = 3; r < data.length; r++) {
        const row = data[r];
        if (!row || !row.length) continue;
        const rawName = String(row[1] || '').trim();
        if (!rawName) continue;
        const opType = normLower(row[9]);
        if (opType === 'обмен') continue;

        const clientKey = normalizeClientName(rawName);
        if (!clientKey) continue;

        for (const pc of paymentCols) {
          const amt = numVal(row[pc.index]);
          if (amt > 0) {
            const monthKey = `${clientKey}|${year}-${String(month).padStart(2, '0')}`;

            if (!monthly.has(monthKey)) {
              monthly.set(monthKey, {
                clientKey, rawName, month, year,
                payments: [], totalPayments: 0,
              });
            }
            const md = monthly.get(monthKey)!;
            md.payments.push({ amount: amt, method: pc.method, month, year });
            md.totalPayments += amt;

            if (!clientTotals.has(clientKey)) {
              clientTotals.set(clientKey, { rawName, total: 0 });
            }
            clientTotals.get(clientKey)!.total += amt;

            sheetPayments++;
            sheetTotal += amt;
          }
        }
      }
      console.log(`    ${sheetName}: ${sheetPayments} payments, ${fmt(sheetTotal)}`);
    }
  }

  return { monthly, clientTotals };
}

// ───────── Step 2: Match clients ─────────

async function matchClients(clientKeys: Set<string>): Promise<{
  matched: Map<string, { clientId: string; crmName: string }>;
  unmatched: string[];
}> {
  const allCrm = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const crmNorm = new Map<string, { id: string; name: string }>();
  for (const c of allCrm) {
    crmNorm.set(normalizeClientName(c.companyName), { id: c.id, name: c.companyName });
  }

  const matched = new Map<string, { clientId: string; crmName: string }>();
  const unmatched: string[] = [];
  const usedCrmIds = new Set<string>();

  // Pass 1: exact
  for (const key of clientKeys) {
    if (crmNorm.has(key)) {
      const crm = crmNorm.get(key)!;
      matched.set(key, { clientId: crm.id, crmName: crm.name });
      usedCrmIds.add(crm.id);
    }
  }

  // Pass 2: prefix
  for (const key of clientKeys) {
    if (matched.has(key)) continue;
    let bestMatch: { id: string; name: string } | null = null;
    let bestLen = 0;
    for (const [crmKey, crmVal] of crmNorm) {
      if (usedCrmIds.has(crmVal.id)) continue;
      if (crmKey.startsWith(key) || key.startsWith(crmKey)) {
        const len = Math.min(key.length, crmKey.length);
        if (len > bestLen && len >= 3) {
          bestLen = len;
          bestMatch = crmVal;
        }
      }
    }
    if (bestMatch) {
      matched.set(key, { clientId: bestMatch.id, crmName: bestMatch.name });
      usedCrmIds.add(bestMatch.id);
    } else {
      unmatched.push(key);
    }
  }

  return { matched, unmatched };
}

// ───────── Main ─────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  REVENUE FIX: ${EXECUTE ? '🔴 EXECUTE MODE' : '🟡 DRY-RUN (use --execute to apply)'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Find admin user
  const admin = await prisma.user.findFirst({
    where: { OR: [{ login: 'admin' }, { role: 'SUPER_ADMIN' }] },
    select: { id: true, login: true },
  });
  if (!admin) { console.error('No admin user found'); process.exit(1); }
  console.log(`Admin: ${admin.login}\n`);

  // ── Phase 1: Delete Сверка payments ──
  console.log('═══ Phase 1: Delete Сверка payments ═══');
  const sverkaCount = await prisma.payment.count({ where: { note: { startsWith: 'Сверка' } } });
  const sverkaSum = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(amount), 0)::text as total FROM payments WHERE note LIKE 'Сверка%'`
  );
  console.log(`  Found ${sverkaCount} Сверка payments, total = ${fmt(Number(sverkaSum[0].total))}`);

  if (EXECUTE && sverkaCount > 0) {
    await prisma.payment.deleteMany({ where: { note: { startsWith: 'Сверка' } } });
    console.log(`  ✅ Deleted ${sverkaCount} Сверка payments`);
  } else if (sverkaCount > 0) {
    console.log(`  Will delete ${sverkaCount} Сверка payments (dry-run)`);
  }

  // ── Phase 2: Parse Excel ──
  console.log('\n═══ Phase 2: Parse Excel files ═══');
  const { monthly, clientTotals } = parseExcel();
  console.log(`\n  Total Excel monthly records: ${monthly.size}`);
  let grandTotal = 0;
  for (const [, ct] of clientTotals) grandTotal += ct.total;
  console.log(`  Grand total Excel payments: ${fmt(grandTotal)}`);

  // ── Phase 3: Match clients ──
  console.log('\n═══ Phase 3: Match Excel → CRM clients ═══');
  const clientKeys = new Set<string>();
  for (const [, md] of monthly) clientKeys.add(md.clientKey);
  const { matched, unmatched } = await matchClients(clientKeys);
  console.log(`  Matched: ${matched.size}, Unmatched: ${unmatched.length}`);

  // ── Phase 4: Per-client per-month reconciliation ──
  console.log('\n═══ Phase 4: Reconcile per-client per-month ═══');

  // Get CRM payments per client per month (excluding Сверка since they're deleted/will be deleted)
  // Note: in dry-run Сверка still exists, so exclude them
  const crmPaymentsRaw = await prisma.$queryRaw<{
    client_id: string; month: number; year: number; total: string;
  }[]>(
    Prisma.sql`SELECT d.client_id,
      EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as month,
      EXTRACT(YEAR FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as year,
      SUM(p.amount)::text as total
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    WHERE p.note IS NULL OR p.note NOT LIKE 'Сверка%'
    GROUP BY d.client_id,
      EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'),
      EXTRACT(YEAR FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')`
  );

  // Build CRM lookup: clientId -> "YYYY-MM" -> amount
  const crmByClientMonth = new Map<string, Map<string, number>>();
  for (const r of crmPaymentsRaw) {
    if (!crmByClientMonth.has(r.client_id)) crmByClientMonth.set(r.client_id, new Map());
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    crmByClientMonth.get(r.client_id)!.set(key, Number(r.total));
  }

  // Find deficits per client per month
  interface PaymentToCreate {
    clientId: string;
    amount: number;
    method: string;
    paidAt: Date;
    note: string;
  }

  const allNewPayments: PaymentToCreate[] = [];
  const clientDeficits: { clientName: string; monthKey: string; excelAmt: number; crmAmt: number; deficit: number }[] = [];

  for (const [monthKey, md] of monthly) {
    const match = matched.get(md.clientKey);
    if (!match) continue;

    const ymKey = `${md.year}-${String(md.month).padStart(2, '0')}`;
    const crmMonthMap = crmByClientMonth.get(match.clientId);
    const crmAmt = crmMonthMap?.get(ymKey) || 0;
    const deficit = md.totalPayments - crmAmt;

    if (deficit <= 100) continue; // close enough, skip

    clientDeficits.push({
      clientName: match.crmName,
      monthKey: ymKey,
      excelAmt: md.totalPayments,
      crmAmt,
      deficit,
    });

    // Create payment records for the deficit — distribute proportionally by method
    const methodTotals = new Map<string, number>();
    for (const p of md.payments) {
      methodTotals.set(p.method, (methodTotals.get(p.method) || 0) + p.amount);
    }

    // Scale each method proportionally to deficit
    const excelTotal = md.totalPayments;
    const scale = deficit / excelTotal;

    let allocated = 0;
    const methods = [...methodTotals.entries()];
    for (let i = 0; i < methods.length; i++) {
      const [method, methodAmt] = methods[i];
      let payAmt: number;
      if (i === methods.length - 1) {
        payAmt = deficit - allocated; // last one gets remainder
      } else {
        payAmt = Math.round(methodAmt * scale * 100) / 100;
      }

      if (payAmt > 0) {
        const paidAt = new Date(Date.UTC(md.year, md.month - 1, 15)); // mid-month
        allNewPayments.push({
          clientId: match.clientId,
          amount: payAmt,
          method,
          paidAt,
          note: `Импорт из Excel: ${MONTH_NAMES_RU[md.month - 1]} ${md.year}`,
        });
        allocated += payAmt;
      }
    }
  }

  // Sort deficits by amount
  clientDeficits.sort((a, b) => b.deficit - a.deficit);

  console.log(`\n  Found ${clientDeficits.length} client-month deficits`);
  console.log(`  Total new payments: ${allNewPayments.length}`);
  let totalDeficit = 0;
  for (const d of clientDeficits) totalDeficit += d.deficit;
  console.log(`  Total deficit: ${fmt(totalDeficit)}\n`);

  // Show top 40 deficits
  console.log('  Top client-month deficits:');
  console.log(`  ${'Client'.padEnd(28)} | ${'Month'.padEnd(7)} | ${'Excel'.padStart(14)} | ${'CRM'.padStart(14)} | ${'Deficit'.padStart(14)}`);
  console.log(`  ${'─'.repeat(28)}-+-${'─'.repeat(7)}-+-${'─'.repeat(14)}-+-${'─'.repeat(14)}-+-${'─'.repeat(14)}`);
  for (const d of clientDeficits.slice(0, 40)) {
    console.log(
      `  ${d.clientName.substring(0, 28).padEnd(28)} | ${d.monthKey.padEnd(7)} | ` +
      `${fmt(d.excelAmt).padStart(14)} | ${fmt(d.crmAmt).padStart(14)} | ${fmt(d.deficit).padStart(14)}`
    );
  }
  if (clientDeficits.length > 40) console.log(`  ... and ${clientDeficits.length - 40} more`);

  // ── Phase 5: Deal allocation for new payments ──
  // We need to assign each payment to a deal. Since we're NOT updating paidAmount,
  // we just need a valid deal_id for each client.
  // Use the oldest non-archived deal per client.
  console.log('\n═══ Phase 5: Allocate payments to deals ═══');

  const clientIds = new Set(allNewPayments.map(p => p.clientId));
  const clientDeals = new Map<string, string>(); // clientId -> dealId

  for (const clientId of clientIds) {
    const deal = await prisma.deal.findFirst({
      where: { clientId, isArchived: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (deal) {
      clientDeals.set(clientId, deal.id);
    }
  }

  // Filter out payments for clients with no deals
  const validPayments = allNewPayments.filter(p => clientDeals.has(p.clientId));
  const skippedCount = allNewPayments.length - validPayments.length;
  if (skippedCount > 0) {
    console.log(`  Skipped ${skippedCount} payments (clients with no deals)`);
  }
  console.log(`  Ready to create ${validPayments.length} payments`);

  // ── Revenue comparison: before vs after ──
  console.log('\n═══ Expected Revenue Impact ═══');

  for (const year of [2024, 2025, 2026]) {
    const maxMonth = year === 2026 ? 3 : 12;
    let yearDiff = 0;
    for (let m = 1; m <= maxMonth; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const monthPayments = validPayments.filter(p => {
        const pd = p.paidAt;
        return pd.getUTCFullYear() === year && pd.getUTCMonth() === m - 1;
      });
      const monthAdd = monthPayments.reduce((s, p) => s + p.amount, 0);
      yearDiff += monthAdd;
    }
    if (yearDiff > 0) {
      console.log(`  ${year}: +${fmt(yearDiff)} in revenue from new payments`);
    }
    // Сверка removal impact
    const sverkaInYear = crmPaymentsRaw.length; // We already computed this differently let's skip
  }

  // ── Phase 6: Execute ──
  if (EXECUTE) {
    console.log('\n═══ Phase 6: EXECUTING ═══');

    // Create payments one by one (to avoid transaction timeout)
    let created = 0;
    for (const p of validPayments) {
      try {
        await prisma.payment.create({
          data: {
            dealId: clientDeals.get(p.clientId)!,
            clientId: p.clientId,
            amount: p.amount,
            method: p.method,
            paidAt: p.paidAt,
            createdBy: admin.id,
            note: p.note,
            createdAt: p.paidAt,
          },
        });
        created++;
        if (created % 100 === 0) {
          console.log(`  Created ${created}/${validPayments.length} payments...`);
        }
      } catch (err) {
        console.error(`  ERROR creating payment for ${p.clientId}: ${(err as Error).message}`);
      }
    }

    console.log(`\n  ✅ Done! Created ${created} payments.`);

    // Post-execution verification
    console.log('\n═══ Post-execution Verification ═══');
    for (const year of [2025, 2026]) {
      const maxMonth = year === 2026 ? 3 : 12;
      for (let m = 1; m <= maxMonth; m++) {
        const monthStart = new Date(`${year}-${String(m).padStart(2, '0')}-01T00:00:00+05:00`);
        const nextMonth = m === 12
          ? new Date(`${year + 1}-01-01T00:00:00+05:00`)
          : new Date(`${year}-${String(m + 1).padStart(2, '0')}-01T00:00:00+05:00`);

        const crmRev = await prisma.$queryRaw<{ total: string }[]>(
          Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
           FROM payments p
           WHERE p.paid_at >= ${monthStart} AND p.paid_at < ${nextMonth}
           AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')`
        );
        console.log(`  ${year}-${String(m).padStart(2, '0')}: CRM revenue = ${fmt(Number(crmRev[0].total))}`);
      }
    }
  } else {
    console.log('\n  ℹ️  DRY-RUN complete. Run with --execute to apply.');
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
