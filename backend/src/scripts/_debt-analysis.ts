import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Total deals count and amounts
  const totalDeals = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0)::text as total_amount, COALESCE(SUM(paid_amount),0)::text as total_paid FROM deals WHERE is_archived = false`
  );
  console.log('=== ALL NON-ARCHIVED DEALS ===');
  console.log('Count:', totalDeals[0].cnt.toString(), '| Total amount:', totalDeals[0].total_amount, '| Total paid:', totalDeals[0].total_paid);

  // 2. The debt query (same as CRM uses)
  const debtCalc = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT
      COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)), 0)::text as total_debt,
      COALESCE(SUM(GREATEST(COALESCE(p.total_paid, 0) - d.amount, 0)), 0)::text as total_overpay,
      COUNT(*)::text as deal_count
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false`
  );
  console.log('\n=== DEBT CALCULATION (what CRM shows) ===');
  console.log('Total debt (positive):', debtCalc[0].total_debt);
  console.log('Total overpayments:', debtCalc[0].total_overpay);
  console.log('Deal count:', debtCalc[0].deal_count);

  // 3. Deals by year
  const byYear = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT
      EXTRACT(YEAR FROM d.created_at)::int as yr,
      COUNT(*)::text as cnt,
      COALESCE(SUM(d.amount),0)::text as total_amount,
      COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)),0)::text as debt
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false
    GROUP BY yr ORDER BY yr`
  );
  console.log('\n=== DEBT BY YEAR (created_at) ===');
  for (const row of byYear) {
    console.log(`  ${row.yr}: ${row.cnt} deals, amount=${row.total_amount}, debt=${row.debt}`);
  }

  // 4. Payment status
  const byStatus = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT payment_status, COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total_amount FROM deals WHERE is_archived = false GROUP BY payment_status ORDER BY payment_status`
  );
  console.log('\n=== BY PAYMENT STATUS ===');
  for (const row of byStatus) {
    console.log(`  ${row.payment_status}: ${row.cnt} deals, amount=${row.total_amount}`);
  }

  // 5. Top 10 biggest unpaid deals
  const topDeals = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT d.id, d.title, d.amount::text, COALESCE(p.total_paid,0)::text as paid,
      (d.amount - COALESCE(p.total_paid,0))::text as debt,
      d.created_at::date as created, d.payment_status
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false AND (d.amount - COALESCE(p.total_paid,0)) > 0
    ORDER BY (d.amount - COALESCE(p.total_paid,0)) DESC
    LIMIT 10`
  );
  console.log('\n=== TOP 10 BIGGEST DEBTS ===');
  for (const row of topDeals) {
    console.log(`  ${row.created} | ${row.title?.substring(0,40)} | amt=${row.amount} | paid=${row.paid} | debt=${row.debt} | status=${row.payment_status}`);
  }

  // 6. Archived vs non-archived
  const archived = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT is_archived, COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM deals GROUP BY is_archived`
  );
  console.log('\n=== ARCHIVED vs ACTIVE ===');
  for (const row of archived) {
    console.log(`  archived=${row.is_archived}: ${row.cnt} deals, total=${row.total}`);
  }

  // 7. Deals with PAID status but still showing debt
  const paidButDebt = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT COUNT(*)::text as cnt,
      COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid,0),0)),0)::text as ghost_debt
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false AND d.payment_status = 'PAID' AND d.amount > COALESCE(p.total_paid,0)`
  );
  console.log('\n=== PAID STATUS BUT STILL HAS DEBT (data inconsistency) ===');
  console.log('Count:', paidButDebt[0].cnt, '| Ghost debt:', paidButDebt[0].ghost_debt);
}

main().catch(console.error).finally(() => prisma.$disconnect());
