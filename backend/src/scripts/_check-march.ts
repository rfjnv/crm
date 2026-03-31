import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('==========================================================');
  console.log('  MARCH 2026 CHECK');
  console.log('==========================================================\n');

  // ---------------------------------------------------------------
  // 1. 2026 deals by month (Tashkent timezone)
  // ---------------------------------------------------------------
  const monthlyDeals = await prisma.$queryRaw<
    { month: number; deals: string; total_amount: string; total_paid: string; gross_debt: string }[]
  >(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as month,
        COUNT(*)::text as deals,
        SUM(d.amount)::text as total_amount,
        SUM(d.paid_amount)::text as total_paid,
        SUM(GREATEST(d.amount - d.paid_amount, 0))::text as gross_debt
      FROM deals d
      WHERE d.created_at >= '2025-12-31T19:00:00Z'
        AND d.created_at < '2026-12-31T19:00:00Z'
        AND d.is_archived = false
      GROUP BY 1
      ORDER BY 1
    `
  );

  const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  console.log('1) 2026 Deals by Month (Asia/Tashkent)');
  console.log('------------------------------------------------------------');
  console.log(
    '   ' +
    'Month'.padEnd(12) +
    'Deals'.padStart(8) +
    'Amount'.padStart(18) +
    'Paid'.padStart(18) +
    'Gross Debt'.padStart(18)
  );
  console.log('   ' + '-'.repeat(74));

  let totalDeals = 0;
  let totalAmount = 0;
  let totalPaid = 0;
  let totalDebt = 0;

  for (const row of monthlyDeals) {
    const name = monthNames[row.month] ?? `M${row.month}`;
    const deals = Number(row.deals);
    const amount = Number(row.total_amount);
    const paid = Number(row.total_paid);
    const debt = Number(row.gross_debt);

    totalDeals += deals;
    totalAmount += amount;
    totalPaid += paid;
    totalDebt += debt;

    console.log(
      '   ' +
      name.padEnd(12) +
      deals.toLocaleString().padStart(8) +
      amount.toLocaleString().padStart(18) +
      paid.toLocaleString().padStart(18) +
      debt.toLocaleString().padStart(18)
    );
  }

  console.log('   ' + '-'.repeat(74));
  console.log(
    '   ' +
    'TOTAL'.padEnd(12) +
    totalDeals.toLocaleString().padStart(8) +
    totalAmount.toLocaleString().padStart(18) +
    totalPaid.toLocaleString().padStart(18) +
    totalDebt.toLocaleString().padStart(18)
  );
  console.log();

  // ---------------------------------------------------------------
  // 2. Global invariant: SUM(payments.amount) vs SUM(deals.paid_amount)
  // ---------------------------------------------------------------
  const [sums] = await prisma.$queryRaw<
    { sum_payments: string; sum_paid_amount: string; diff: string }[]
  >(
    Prisma.sql`
      SELECT
        COALESCE(SUM(p_totals.total_paid), 0)::text   AS sum_payments,
        COALESCE(SUM(d.paid_amount),       0)::text   AS sum_paid_amount,
        (COALESCE(SUM(p_totals.total_paid), 0)
         - COALESCE(SUM(d.paid_amount), 0))::text     AS diff
      FROM deals d
      LEFT JOIN (
        SELECT deal_id, SUM(amount) AS total_paid
        FROM payments
        GROUP BY deal_id
      ) p_totals ON p_totals.deal_id = d.id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED', 'REJECTED')
    `
  );

  const sumPayments = Number(sums.sum_payments);
  const sumPaid2 = Number(sums.sum_paid_amount);
  const diff = Number(sums.diff);
  const match = diff === 0 ? 'OK' : 'MISMATCH';

  console.log('2) Global Invariant: SUM(payments) vs SUM(deals.paid_amount)');
  console.log('------------------------------------------------------------');
  console.log(`   SUM(payments.amount)   = ${sumPayments.toLocaleString()}`);
  console.log(`   SUM(deals.paid_amount) = ${sumPaid2.toLocaleString()}`);
  console.log(`   Difference             = ${diff.toLocaleString()}  [${match}]`);
  console.log();

  // ---------------------------------------------------------------
  // 3. Total debt across ALL years (active, non-canceled deals)
  // ---------------------------------------------------------------
  const [debtRow] = await prisma.$queryRaw<
    { total_deals: string; total_amount: string; total_paid: string; total_debt: string }[]
  >(
    Prisma.sql`
      SELECT
        COUNT(*)::text AS total_deals,
        SUM(d.amount)::text AS total_amount,
        SUM(d.paid_amount)::text AS total_paid,
        SUM(GREATEST(d.amount - d.paid_amount, 0))::text AS total_debt
      FROM deals d
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED', 'REJECTED')
    `
  );

  const allDeals = Number(debtRow.total_deals);
  const allAmount = Number(debtRow.total_amount);
  const allPaid = Number(debtRow.total_paid);
  const allDebt = Number(debtRow.total_debt);

  console.log('3) Total Debt Across All Years (active, non-canceled deals)');
  console.log('------------------------------------------------------------');
  console.log(`   Total deals            = ${allDeals.toLocaleString()}`);
  console.log(`   Total amount           = ${allAmount.toLocaleString()}`);
  console.log(`   Total paid             = ${allPaid.toLocaleString()}`);
  console.log(`   Total gross debt       = ${allDebt.toLocaleString()}`);
  console.log();

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log('==========================================================');
  console.log('  SUMMARY');
  console.log('==========================================================');
  console.log(`  2026 months with deals  : ${monthlyDeals.length}`);
  console.log(`  2026 total deals        : ${totalDeals}`);
  console.log(`  2026 gross debt         : ${totalDebt.toLocaleString()}`);
  console.log(`  Invariant check         : ${match}${diff !== 0 ? ` (diff=${diff.toLocaleString()})` : ''}`);
  console.log(`  All-time gross debt     : ${allDebt.toLocaleString()}`);
  console.log('==========================================================\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
