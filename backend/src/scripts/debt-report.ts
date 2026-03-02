/**
 * Debt analysis report — generates 5 SQL reports + CSV files.
 *
 * Run: cd backend && npx tsx src/scripts/debt-report.ts
 *
 * Reports:
 *   1. total_debt_by_year — debt by year
 *   2. total_debt_all — overall debt + overpayments + net balance
 *   3. top_debtors — top 20 clients with outstanding debt
 *   4. top_overpayments — top 20 clients with overpayments
 *   5. per_month_reconciliation — monthly debt reconciliation
 */

import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const REPORTS_DIR = path.resolve(__dirname, '../../reports');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeCsv(filename: string, headers: string[], rows: Record<string, unknown>[]) {
  ensureDir(REPORTS_DIR);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => {
      const val = row[h];
      if (val == null) return '';
      const s = String(val);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
  console.log(`  CSV: ${filepath}`);
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' млрд';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн';
  return n.toLocaleString('ru-RU');
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  DEBT ANALYSIS REPORT');
  console.log('═══════════════════════════════════════════════\n');

  // ────────────────────────────────────────────
  // 1. Debt by year
  // ────────────────────────────────────────────
  console.log('── 1. DEBT BY YEAR ──');

  const debtByYear = await prisma.$queryRaw<
    { year: number; deals_count: string; total_amount: string; total_paid: string; debt: string }[]
  >(Prisma.sql`
    SELECT
      EXTRACT(YEAR FROM d.created_at)::int as year,
      COUNT(d.id)::text as deals_count,
      COALESCE(SUM(d.amount), 0)::text as total_amount,
      COALESCE(SUM(COALESCE(p.total_paid, 0)), 0)::text as total_paid,
      COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)), 0)::text as debt
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false
      AND (d.amount - COALESCE(p.total_paid, 0)) > 0
    GROUP BY EXTRACT(YEAR FROM d.created_at)
    ORDER BY year
  `);

  console.log('  Год    | Сделок | Сумма сделок     | Оплачено         | Долг');
  console.log('  -------+--------+------------------+------------------+------------------');
  for (const row of debtByYear) {
    console.log(`  ${row.year}   | ${String(row.deals_count).padStart(6)} | ${fmtNum(Number(row.total_amount)).padStart(16)} | ${fmtNum(Number(row.total_paid)).padStart(16)} | ${fmtNum(Number(row.debt)).padStart(16)}`);
  }

  writeCsv('1_debt_by_year.csv', ['year', 'deals_count', 'total_amount', 'total_paid', 'debt'],
    debtByYear.map(r => ({
      year: r.year,
      deals_count: Number(r.deals_count),
      total_amount: Number(r.total_amount),
      total_paid: Number(r.total_paid),
      debt: Number(r.debt),
    })));

  // ────────────────────────────────────────────
  // 2. Total debt summary
  // ────────────────────────────────────────────
  console.log('\n── 2. TOTAL DEBT SUMMARY ──');

  const totalSummary = await prisma.$queryRaw<
    { total_deals: string; total_amount: string; total_paid: string; debt_positive: string; overpayments: string; net_balance: string }[]
  >(Prisma.sql`
    SELECT
      COUNT(*)::text as total_deals,
      COALESCE(SUM(d.amount), 0)::text as total_amount,
      COALESCE(SUM(COALESCE(p.total_paid, 0)), 0)::text as total_paid,
      COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)), 0)::text as debt_positive,
      COALESCE(SUM(GREATEST(COALESCE(p.total_paid, 0) - d.amount, 0)), 0)::text as overpayments,
      (COALESCE(SUM(d.amount), 0) - COALESCE(SUM(COALESCE(p.total_paid, 0)), 0))::text as net_balance
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false
  `);

  const ts = totalSummary[0];
  console.log(`  Всего сделок (активных):  ${ts.total_deals}`);
  console.log(`  Сумма сделок:             ${fmtNum(Number(ts.total_amount))}`);
  console.log(`  Всего оплачено:           ${fmtNum(Number(ts.total_paid))}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Долг (положительный):      ${fmtNum(Number(ts.debt_positive))}`);
  console.log(`  Переплаты:                -${fmtNum(Number(ts.overpayments))}`);
  console.log(`  Чистый баланс:             ${fmtNum(Number(ts.net_balance))}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Проверка: долг - переплаты = ${fmtNum(Number(ts.debt_positive) - Number(ts.overpayments))}`);
  console.log(`  Проверка: сумма - оплач    = ${fmtNum(Number(ts.total_amount) - Number(ts.total_paid))}`);

  writeCsv('2_total_debt_summary.csv',
    ['total_deals', 'total_amount', 'total_paid', 'debt_positive', 'overpayments', 'net_balance'],
    [{ ...ts, total_deals: Number(ts.total_deals), total_amount: Number(ts.total_amount), total_paid: Number(ts.total_paid), debt_positive: Number(ts.debt_positive), overpayments: Number(ts.overpayments), net_balance: Number(ts.net_balance) }]);

  // ────────────────────────────────────────────
  // 3. Top 20 debtors
  // ────────────────────────────────────────────
  console.log('\n── 3. TOP 20 DEBTORS ──');

  const topDebtors = await prisma.$queryRaw<
    { id: string; company_name: string; deals_count: string; total_amount: string; total_paid: string; debt: string }[]
  >(Prisma.sql`
    SELECT c.id, c.company_name,
      COUNT(d.id)::text as deals_count,
      COALESCE(SUM(d.amount), 0)::text as total_amount,
      COALESCE(SUM(COALESCE(p.total_paid, 0)), 0)::text as total_paid,
      COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)), 0)::text as debt
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false
    GROUP BY c.id, c.company_name
    HAVING SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)) > 0
    ORDER BY SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)) DESC
    LIMIT 20
  `);

  console.log('  #  | Клиент                         | Сделок | Сумма            | Оплач            | Долг');
  console.log('  ---+--------------------------------+--------+------------------+------------------+------------------');
  topDebtors.forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(2)} | ${r.company_name.substring(0, 30).padEnd(30)} | ${String(r.deals_count).padStart(6)} | ${fmtNum(Number(r.total_amount)).padStart(16)} | ${fmtNum(Number(r.total_paid)).padStart(16)} | ${fmtNum(Number(r.debt)).padStart(16)}`);
  });

  writeCsv('3_top_debtors.csv',
    ['rank', 'client_id', 'company_name', 'deals_count', 'total_amount', 'total_paid', 'debt'],
    topDebtors.map((r, i) => ({
      rank: i + 1,
      client_id: r.id,
      company_name: r.company_name,
      deals_count: Number(r.deals_count),
      total_amount: Number(r.total_amount),
      total_paid: Number(r.total_paid),
      debt: Number(r.debt),
    })));

  // ────────────────────────────────────────────
  // 4. Top 20 overpayments
  // ────────────────────────────────────────────
  console.log('\n── 4. TOP 20 OVERPAYMENTS ──');

  const topOverpay = await prisma.$queryRaw<
    { id: string; company_name: string; deals_count: string; total_amount: string; total_paid: string; overpayment: string }[]
  >(Prisma.sql`
    SELECT c.id, c.company_name,
      COUNT(d.id)::text as deals_count,
      COALESCE(SUM(d.amount), 0)::text as total_amount,
      COALESCE(SUM(COALESCE(p.total_paid, 0)), 0)::text as total_paid,
      (COALESCE(SUM(COALESCE(p.total_paid, 0)), 0) - COALESCE(SUM(d.amount), 0))::text as overpayment
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false
    GROUP BY c.id, c.company_name
    HAVING SUM(COALESCE(p.total_paid, 0)) > SUM(d.amount)
    ORDER BY (SUM(COALESCE(p.total_paid, 0)) - SUM(d.amount)) DESC
    LIMIT 20
  `);

  if (topOverpay.length === 0) {
    console.log('  Переплат не обнаружено.');
  } else {
    console.log('  #  | Клиент                         | Сделок | Сумма            | Оплач            | Переплата');
    console.log('  ---+--------------------------------+--------+------------------+------------------+------------------');
    topOverpay.forEach((r, i) => {
      console.log(`  ${String(i + 1).padStart(2)} | ${r.company_name.substring(0, 30).padEnd(30)} | ${String(r.deals_count).padStart(6)} | ${fmtNum(Number(r.total_amount)).padStart(16)} | ${fmtNum(Number(r.total_paid)).padStart(16)} | ${fmtNum(Number(r.overpayment)).padStart(16)}`);
    });
  }

  writeCsv('4_top_overpayments.csv',
    ['rank', 'client_id', 'company_name', 'deals_count', 'total_amount', 'total_paid', 'overpayment'],
    topOverpay.map((r, i) => ({
      rank: i + 1,
      client_id: r.id,
      company_name: r.company_name,
      deals_count: Number(r.deals_count),
      total_amount: Number(r.total_amount),
      total_paid: Number(r.total_paid),
      overpayment: Number(r.overpayment),
    })));

  // ────────────────────────────────────────────
  // 5. Monthly debt reconciliation
  // ────────────────────────────────────────────
  console.log('\n── 5. MONTHLY DEBT RECONCILIATION ──');

  const monthlyRecon = await prisma.$queryRaw<
    { year: number; month: number; deals_count: string; revenue: string; paid_in_month: string; closing_debt: string }[]
  >(Prisma.sql`
    WITH monthly_deals AS (
      SELECT
        EXTRACT(YEAR FROM d.created_at)::int as year,
        EXTRACT(MONTH FROM d.created_at)::int as month,
        COUNT(d.id)::text as deals_count,
        COALESCE(SUM(d.amount), 0)::text as revenue
      FROM deals d
      WHERE d.is_archived = false
      GROUP BY EXTRACT(YEAR FROM d.created_at), EXTRACT(MONTH FROM d.created_at)
    ),
    monthly_payments AS (
      SELECT
        EXTRACT(YEAR FROM p.paid_at)::int as year,
        EXTRACT(MONTH FROM p.paid_at)::int as month,
        COALESCE(SUM(p.amount), 0)::text as paid_in_month
      FROM payments p
      GROUP BY EXTRACT(YEAR FROM p.paid_at), EXTRACT(MONTH FROM p.paid_at)
    )
    SELECT
      COALESCE(md.year, mp.year) as year,
      COALESCE(md.month, mp.month) as month,
      COALESCE(md.deals_count, '0') as deals_count,
      COALESCE(md.revenue, '0') as revenue,
      COALESCE(mp.paid_in_month, '0') as paid_in_month,
      '0' as closing_debt
    FROM monthly_deals md
    FULL OUTER JOIN monthly_payments mp ON md.year = mp.year AND md.month = mp.month
    ORDER BY year, month
  `);

  console.log('  Год  | Мес | Сделок | Выручка          | Оплач в мес      ');
  console.log('  -----+-----+--------+------------------+------------------');
  for (const row of monthlyRecon) {
    console.log(`  ${row.year} | ${String(row.month).padStart(3)} | ${String(row.deals_count).padStart(6)} | ${fmtNum(Number(row.revenue)).padStart(16)} | ${fmtNum(Number(row.paid_in_month)).padStart(16)}`);
  }

  writeCsv('5_monthly_reconciliation.csv',
    ['year', 'month', 'deals_count', 'revenue', 'paid_in_month'],
    monthlyRecon.map(r => ({
      year: r.year,
      month: r.month,
      deals_count: Number(r.deals_count),
      revenue: Number(r.revenue),
      paid_in_month: Number(r.paid_in_month),
    })));

  // ────────────────────────────────────────────
  // Explanation
  // ────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log('  EXPLANATION: 11.28 млрд vs 1.63 млрд');
  console.log('═══════════════════════════════════════════════');
  console.log('  CRM debt = 11.28 млрд — это КУМУЛЯТИВНЫЙ долг по ВСЕМ сделкам');
  console.log('  за все годы (2025 + 2026), где (amount - paid) > 0.');
  console.log('');
  console.log('  Excel debt = 1.63 млрд — вероятно подсчёт за конкретный');
  console.log('  месяц/период или с другим фильтром (например, только');
  console.log('  незакрытые сделки текущего месяца).');
  console.log('');
  console.log('  Формулы CRM:');
  console.log('    debt_positive = SUM(GREATEST(amount - paid, 0)) WHERE is_archived=false AND debt>0');
  console.log('    overpayments  = SUM(GREATEST(paid - amount, 0)) WHERE is_archived=false');
  console.log('    net_balance   = SUM(amount) - SUM(paid) = debt_positive - overpayments');
  console.log('═══════════════════════════════════════════════');
  console.log(`\n  Все CSV отчёты сохранены в: ${REPORTS_DIR}`);
}

main()
  .catch((err) => {
    console.error('Report failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
