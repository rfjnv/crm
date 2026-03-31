/**
 * Revenue Audit: CRM (payments, deals) vs Excel
 * Compares revenue from 3 CRM sources + Excel per month
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'QR', 'PAYME', 'TERMINAL'] as const;

type Row = (string | number | undefined | null)[];

function numVal(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getSheetLayout(ws: XLSX.WorkSheet) {
  const ref = ws['!ref'];
  const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
  const paymentStartCol = totalCols - 17;
  const paymentCols = PAYMENT_METHODS.map((method, i) => ({
    index: paymentStartCol + i * 3 + 1, // "this-month" sub-column
    method,
  }));
  return { paymentCols, totalCols };
}

function readExcelRevenue(filePath: string, year: number): Map<number, { payments: number; dealAmounts: number }> {
  const wb = XLSX.readFile(filePath);
  const result = new Map<number, { payments: number; dealAmounts: number }>();

  for (const sheetName of wb.SheetNames) {
    const sheetLower = sheetName.toLowerCase().trim();
    let monthIdx = -1;
    for (let i = 0; i < MONTH_NAMES.length; i++) {
      if (sheetLower.startsWith(MONTH_NAMES[i]) || sheetLower === MONTH_NAMES[i]) {
        monthIdx = i;
        break;
      }
    }
    if (monthIdx < 0) continue;
    const month = monthIdx + 1;

    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as Row[];
    const layout = getSheetLayout(ws);

    let totalPayments = 0;
    let totalDealAmounts = 0;

    // Data rows start at index 3 (row 4)
    for (let r = 3; r < data.length; r++) {
      const row = data[r];
      if (!row || !row.length) continue;

      const client = String(row[1] || '').trim();
      if (!client) continue;

      // Deal amount = qty * price (col 5,7)
      const qty = numVal(row[5]);
      const price = numVal(row[7]);
      // Col 8 = "сумма" (total for line)
      const lineAmount = numVal(row[8]);

      // Check op type - skip EXCHANGE
      const opType = String(row[9] || '').trim().toLowerCase();
      if (opType === 'обмен') continue;

      // Use lineAmount if available, else qty*price
      if (lineAmount > 0) {
        totalDealAmounts += lineAmount;
      } else if (qty > 0 && price > 0) {
        totalDealAmounts += qty * price;
      }

      // Payments
      for (const pc of layout.paymentCols) {
        const amt = numVal(row[pc.index]);
        if (amt > 0) totalPayments += amt;
      }
    }

    result.set(month, { payments: totalPayments, dealAmounts: totalDealAmounts });
  }

  return result;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

function pctDiff(a: number, b: number): string {
  if (b === 0 && a === 0) return '0%';
  if (b === 0) return 'N/A';
  const pct = ((a - b) / Math.abs(b)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

async function main() {
  const TZ = `'Asia/Tashkent'`;

  console.log('═══════════════════════════════════════════════════════');
  console.log('       REVENUE AUDIT: CRM vs Excel');
  console.log('═══════════════════════════════════════════════════════\n');

  // --- Read Excel files ---
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const excelFiles: { year: number; file: string }[] = [
    { year: 2025, file: path.join(projectRoot, 'analytics_2025-12-29.xlsx') },
    { year: 2026, file: path.join(projectRoot, 'analytics_2026-03-12.xlsx') },
  ];

  const excelData = new Map<string, { payments: number; dealAmounts: number }>(); // key: "YYYY-MM"

  for (const { year, file } of excelFiles) {
    try {
      const data = readExcelRevenue(file, year);
      for (const [month, vals] of data) {
        excelData.set(`${year}-${String(month).padStart(2, '0')}`, vals);
      }
      console.log(`Excel ${year}: loaded ${data.size} months from ${path.basename(file)}`);
    } catch (e: any) {
      console.log(`Excel ${year}: SKIP (${e.message})`);
    }
  }

  // --- Query CRM for each year/month ---
  for (const year of [2025, 2026]) {
    const maxMonth = year === 2026 ? 3 : 12;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  YEAR: ${year}`);
    console.log(`${'─'.repeat(60)}`);

    let yearCrmPayments = 0;
    let yearCrmDeals = 0;
    let yearExcelPayments = 0;
    let yearExcelDeals = 0;

    for (let month = 1; month <= maxMonth; month++) {
      const monthStart = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+05:00`);
      const nextMonth = month === 12
        ? new Date(`${year + 1}-01-01T00:00:00+05:00`)
        : new Date(`${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00+05:00`);

      // CRM Source 1: SUM(payments.amount) - from payments table (cash revenue)
      const crmPaymentsRaw = await prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
         FROM payments p
         WHERE p.paid_at >= ${monthStart} AND p.paid_at < ${nextMonth}
         AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')`
      );
      const crmPayments = Number(crmPaymentsRaw[0].total);

      // CRM Source 1b: SUM(payments.amount) INCLUDING sverka
      const crmPaymentsAllRaw = await prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
         FROM payments p
         WHERE p.paid_at >= ${monthStart} AND p.paid_at < ${nextMonth}`
      );
      const crmPaymentsAll = Number(crmPaymentsAllRaw[0].total);

      // CRM Source 2: SUM(deals.amount) - paper revenue (deals created this month)
      const crmDealsRaw = await prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(d.amount), 0)::text as total
         FROM deals d
         WHERE d.created_at >= ${monthStart} AND d.created_at < ${nextMonth}
         AND d.is_archived = false
         AND d.status NOT IN ('CANCELED','REJECTED')`
      );
      const crmDeals = Number(crmDealsRaw[0].total);

      // CRM Source 3: Sverka payments only
      const sverkaRaw = await prisma.$queryRaw<{ total: string; cnt: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as cnt
         FROM payments p
         WHERE p.paid_at >= ${monthStart} AND p.paid_at < ${nextMonth}
         AND p.note LIKE 'Сверка%'`
      );
      const sverkaTotal = Number(sverkaRaw[0].total);
      const sverkaCount = Number(sverkaRaw[0].cnt);

      // Excel data
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const excel = excelData.get(key);
      const excelPayments = excel?.payments ?? 0;
      const excelDeals = excel?.dealAmounts ?? 0;

      yearCrmPayments += crmPayments;
      yearCrmDeals += crmDeals;
      yearExcelPayments += excelPayments;
      yearExcelDeals += excelDeals;

      const paymentDiff = crmPayments - excelPayments;
      const dealDiff = crmDeals - excelDeals;

      const monthName = MONTH_NAMES[month - 1].toUpperCase();
      const hasMismatch = Math.abs(paymentDiff) > 100 || Math.abs(dealDiff) > 100;
      const marker = hasMismatch ? ' ⚠️' : ' ✓';

      console.log(`\n  ${monthName} ${year}${marker}`);
      console.log(`  ┌─────────────────────────┬───────────────────┬──────────────────┬────────────────┐`);
      console.log(`  │ Source                  │ Payments (cash)   │ Deals (paper)    │ Notes          │`);
      console.log(`  ├─────────────────────────┼───────────────────┼──────────────────┼────────────────┤`);
      console.log(`  │ CRM (payments table)    │ ${fmt(crmPayments).padStart(17)} │                  │ excl. Сверка   │`);
      console.log(`  │ CRM (incl. Сверка)      │ ${fmt(crmPaymentsAll).padStart(17)} │                  │ all payments   │`);
      console.log(`  │ CRM (deals.amount)      │                   │ ${fmt(crmDeals).padStart(16)} │ by createdAt   │`);
      console.log(`  │ Excel                   │ ${fmt(excelPayments).padStart(17)} │ ${fmt(excelDeals).padStart(16)} │                │`);
      console.log(`  ├─────────────────────────┼───────────────────┼──────────────────┼────────────────┤`);
      console.log(`  │ DIFF (CRM - Excel)      │ ${fmt(paymentDiff).padStart(17)} │ ${fmt(dealDiff).padStart(16)} │ ${pctDiff(crmPayments, excelPayments).padStart(14)} │`);
      if (sverkaCount > 0) {
        console.log(`  │ Сверка payments         │ ${fmt(sverkaTotal).padStart(17)} │    ${String(sverkaCount).padStart(4)} records │                │`);
      }
      console.log(`  └─────────────────────────┴───────────────────┴──────────────────┴────────────────┘`);

      // If big diff, show per-method breakdown
      if (Math.abs(paymentDiff) > 100) {
        const methodBreakdown = await prisma.$queryRaw<{ method: string; total: string }[]>(
          Prisma.sql`SELECT COALESCE(p.method, 'NULL') as method, SUM(p.amount)::text as total
           FROM payments p
           WHERE p.paid_at >= ${monthStart} AND p.paid_at < ${nextMonth}
           AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
           GROUP BY p.method
           ORDER BY SUM(p.amount) DESC`
        );
        console.log(`    CRM payments by method:`);
        for (const m of methodBreakdown) {
          console.log(`      ${(m.method || 'NULL').padEnd(12)} ${fmt(Number(m.total)).padStart(17)}`);
        }
      }
    }

    // Year totals
    const yearPayDiff = yearCrmPayments - yearExcelPayments;
    const yearDealDiff = yearCrmDeals - yearExcelDeals;
    console.log(`\n  ${'═'.repeat(58)}`);
    console.log(`  TOTAL ${year}:`);
    console.log(`    CRM  payments: ${fmt(yearCrmPayments).padStart(17)}    deals: ${fmt(yearCrmDeals).padStart(17)}`);
    console.log(`    Excel payments: ${fmt(yearExcelPayments).padStart(17)}    deals: ${fmt(yearExcelDeals).padStart(17)}`);
    console.log(`    DIFF payments: ${fmt(yearPayDiff).padStart(17)} (${pctDiff(yearCrmPayments, yearExcelPayments)})    deals: ${fmt(yearDealDiff).padStart(17)} (${pctDiff(yearCrmDeals, yearExcelDeals)})`);
  }

  // --- Internal CRM consistency check ---
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  INTERNAL CRM CONSISTENCY CHECK`);
  console.log(`${'═'.repeat(60)}`);

  // Check: deals.paidAmount vs SUM(payments.amount) per deal
  const inconsistentDeals = await prisma.$queryRaw<{
    deal_id: string; title: string; paid_amount: string;
    payments_sum: string; diff: string; client_name: string;
  }[]>(
    Prisma.sql`SELECT d.id as deal_id, d.title, d.paid_amount::text,
       COALESCE(ps.total, 0)::text as payments_sum,
       (d.paid_amount - COALESCE(ps.total, 0))::text as diff,
       c.company_name as client_name
     FROM deals d
     LEFT JOIN (
       SELECT deal_id, SUM(amount) as total FROM payments GROUP BY deal_id
     ) ps ON ps.deal_id = d.id
     JOIN clients c ON c.id = d.client_id
     WHERE d.is_archived = false
       AND ABS(d.paid_amount - COALESCE(ps.total, 0)) > 1
     ORDER BY ABS(d.paid_amount - COALESCE(ps.total, 0)) DESC
     LIMIT 30`
  );

  if (inconsistentDeals.length > 0) {
    console.log(`\n  ⚠️  ${inconsistentDeals.length}+ deals where paidAmount != SUM(payments):`);
    console.log(`  ${'─'.repeat(56)}`);
    let totalInconsistency = 0;
    for (const d of inconsistentDeals) {
      const diff = Number(d.diff);
      totalInconsistency += diff;
      console.log(`    ${d.client_name.substring(0, 25).padEnd(25)} | deal.paid=${fmt(Number(d.paid_amount)).padStart(12)} | payments=${fmt(Number(d.payments_sum)).padStart(12)} | diff=${fmt(diff).padStart(10)}`);
    }
    console.log(`  ${'─'.repeat(56)}`);
    console.log(`    Total inconsistency: ${fmt(totalInconsistency)}`);
  } else {
    console.log(`\n  ✓ All deals: paidAmount matches SUM(payments.amount)`);
  }

  // Check: Dashboard revenue vs Analytics revenue for current month
  const now = new Date();
  const currentMonthStart = new Date(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00+05:00`);
  const nextMonthStart = now.getMonth() === 11
    ? new Date(`${now.getFullYear() + 1}-01-01T00:00:00+05:00`)
    : new Date(`${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01T00:00:00+05:00`);

  // Dashboard-style (today + month)
  const dashMonthRaw = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
     FROM payments p
     WHERE p.paid_at >= ${currentMonthStart} AND p.paid_at < ${nextMonthStart}
     AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')`
  );

  // Analytics-style (same query but check period logic)
  const analyticsMonthRaw = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
     FROM payments p
     WHERE p.paid_at >= ${currentMonthStart} AND p.paid_at < ${nextMonthStart}
     AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')`
  );

  // History-style (deals.amount)
  const historyMonthRaw = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(d.amount), 0)::text as total
     FROM deals d
     WHERE d.created_at >= ${currentMonthStart} AND d.created_at < ${nextMonthStart}
     AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')`
  );

  console.log(`\n  Current month (${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}) — CRM internal comparison:`);
  console.log(`    Dashboard (payments):     ${fmt(Number(dashMonthRaw[0].total))}`);
  console.log(`    Analytics (payments):     ${fmt(Number(analyticsMonthRaw[0].total))}`);
  console.log(`    History   (deals.amount): ${fmt(Number(historyMonthRaw[0].total))}`);
  const dashVsHistory = Number(dashMonthRaw[0].total) - Number(historyMonthRaw[0].total);
  if (Math.abs(dashVsHistory) > 100) {
    console.log(`    ⚠️  Dashboard vs History diff: ${fmt(dashVsHistory)} (expected: payments != deal amounts)`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Done.');

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
