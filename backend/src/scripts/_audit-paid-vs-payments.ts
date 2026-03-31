import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== PAID_AMOUNT vs SUM(payments) discrepancy check ===\n');

  // Check for each deal year: SUM(paid_amount) vs SUM(payments)
  const discrepancy = await prisma.$queryRaw<
    { deal_year: number; deal_count: string; sum_amount: string; sum_paid_amount: string; sum_payments: string; diff: string; deals_with_diff: string }[]
  >`
    SELECT
      EXTRACT(YEAR FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as deal_year,
      COUNT(d.id)::text as deal_count,
      COALESCE(SUM(d.amount), 0)::text as sum_amount,
      COALESCE(SUM(d.paid_amount), 0)::text as sum_paid_amount,
      COALESCE(SUM(COALESCE(hp.total_payments, 0)), 0)::text as sum_payments,
      (COALESCE(SUM(d.paid_amount), 0) - COALESCE(SUM(COALESCE(hp.total_payments, 0)), 0))::text as diff,
      COUNT(d.id) FILTER (WHERE ABS(d.paid_amount - COALESCE(hp.total_payments, 0)) > 1)::text as deals_with_diff
    FROM deals d
    LEFT JOIN (
      SELECT p.deal_id, SUM(p.amount) as total_payments
      FROM payments p
      GROUP BY p.deal_id
    ) hp ON hp.deal_id = d.id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY deal_year
    ORDER BY deal_year
  `;

  console.log('Year | Deals | SUM(amount)      | SUM(paid_amount) | SUM(payments)     | Diff (paid-pay) | Deals w/diff');
  console.log('-----|-------|------------------|------------------|-------------------|-----------------|--------');
  for (const r of discrepancy) {
    console.log(`${r.deal_year} | ${r.deal_count.padStart(5)} | ${Number(r.sum_amount).toLocaleString().padStart(16)} | ${Number(r.sum_paid_amount).toLocaleString().padStart(16)} | ${Number(r.sum_payments).toLocaleString().padStart(17)} | ${Number(r.diff).toLocaleString().padStart(15)} | ${r.deals_with_diff}`);
  }

  // Now test: cumulative debt using paid_amount (current) but assigned to deal year
  console.log('\n\n=== TEST: Debt = SUM(amount) - SUM(paid_amount) cumulative ===\n');
  const years = [2024, 2025];
  for (const year of years) {
    const yearEnd = new Date(`${year}-12-31T19:00:00Z`);

    const result = await prisma.$queryRaw<{ sum_amount: string; sum_paid: string }[]>`
      SELECT
        COALESCE(SUM(d.amount), 0)::text as sum_amount,
        COALESCE(SUM(d.paid_amount), 0)::text as sum_paid
      FROM deals d
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.created_at < ${yearEnd}
    `;
    const debt = Number(result[0].sum_amount) - Number(result[0].sum_paid);
    const target = year === 2024 ? 1125627628 : 916433945;
    console.log(`  ${year}: amount=${Number(result[0].sum_amount).toLocaleString()} paid=${Number(result[0].sum_paid).toLocaleString()}`);
    console.log(`       DEBT = ${debt.toLocaleString()} | TARGET = ${target.toLocaleString()} | diff=${(debt - target).toLocaleString()}`);
  }

  // Check how many deals have paid_amount != SUM(payments)
  console.log('\n\n=== TOP 20 deals with biggest paid_amount vs SUM(payments) discrepancy ===\n');
  const bigDiffs = await prisma.$queryRaw<
    { id: string; title: string; amount: string; paid_amount: string; sum_payments: string; diff: string; deal_year: number }[]
  >`
    SELECT d.id, d.title, d.amount::text, d.paid_amount::text,
      COALESCE(hp.total_payments, 0)::text as sum_payments,
      (d.paid_amount - COALESCE(hp.total_payments, 0))::text as diff,
      EXTRACT(YEAR FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as deal_year
    FROM deals d
    LEFT JOIN (
      SELECT p.deal_id, SUM(p.amount) as total_payments
      FROM payments p
      GROUP BY p.deal_id
    ) hp ON hp.deal_id = d.id
    WHERE ABS(d.paid_amount - COALESCE(hp.total_payments, 0)) > 1
      AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    ORDER BY ABS(d.paid_amount - COALESCE(hp.total_payments, 0)) DESC
    LIMIT 20
  `;

  console.log('Deal ID | Year | Amount | paid_amount | SUM(payments) | Diff');
  for (const r of bigDiffs) {
    console.log(`${r.id.substring(0,8)}.. | ${r.deal_year} | ${Number(r.amount).toLocaleString()} | ${Number(r.paid_amount).toLocaleString()} | ${Number(r.sum_payments).toLocaleString()} | ${Number(r.diff).toLocaleString()}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
