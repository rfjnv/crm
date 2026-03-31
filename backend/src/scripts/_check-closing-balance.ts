import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const TZ = 'Asia/Tashkent';

async function main() {
  // Check closing balance for Dec 2025 and Feb 2026
  // Excel says: Dec 2025 = 771,709,923 | Feb 2026 = 1,013,072,673

  // 1. Year 2026 monthly balances (Jan, Feb)
  const balance2026 = await prisma.$queryRaw<
    { month: number; opening_balance: string; closing_balance: string }[]
  >(
    Prisma.sql`WITH deal_paid AS (
      SELECT d.id as deal_id, d.amount as deal_amount, d.created_at,
        m.month,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.paid_at < make_timestamptz(2026, m.month::int, 1, 0, 0, 0, ${TZ})
        ), 0) as paid_before_open,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.paid_at < make_timestamptz(2026, m.month::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
        ), 0) as paid_before_close
      FROM deals d
      CROSS JOIN generate_series(1, 3) as m(month)
      LEFT JOIN payments p ON p.deal_id = d.id
      WHERE d.is_archived = false
      GROUP BY d.id, d.amount, d.created_at, m.month
    )
    SELECT month,
      COALESCE(SUM(GREATEST(deal_amount - paid_before_open, 0)) FILTER (
        WHERE created_at < make_timestamptz(2026, month::int, 1, 0, 0, 0, ${TZ})
      ), 0)::text as opening_balance,
      COALESCE(SUM(GREATEST(deal_amount - paid_before_close, 0)) FILTER (
        WHERE created_at < make_timestamptz(2026, month::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
      ), 0)::text as closing_balance
    FROM deal_paid
    GROUP BY month
    ORDER BY month`
  );

  console.log('=== 2026 Monthly Balances ===');
  for (const r of balance2026) {
    console.log(`  Month ${r.month}: opening=${Number(r.opening_balance).toLocaleString()} | closing=${Number(r.closing_balance).toLocaleString()}`);
  }

  // 2. Year 2025 monthly balances (last 3 months)
  const balance2025 = await prisma.$queryRaw<
    { month: number; opening_balance: string; closing_balance: string }[]
  >(
    Prisma.sql`WITH deal_paid AS (
      SELECT d.id as deal_id, d.amount as deal_amount, d.created_at,
        m.month,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.paid_at < make_timestamptz(2025, m.month::int, 1, 0, 0, 0, ${TZ})
        ), 0) as paid_before_open,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.paid_at < make_timestamptz(2025, m.month::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
        ), 0) as paid_before_close
      FROM deals d
      CROSS JOIN generate_series(1, 12) as m(month)
      LEFT JOIN payments p ON p.deal_id = d.id
      WHERE d.is_archived = false
      GROUP BY d.id, d.amount, d.created_at, m.month
    )
    SELECT month,
      COALESCE(SUM(GREATEST(deal_amount - paid_before_open, 0)) FILTER (
        WHERE created_at < make_timestamptz(2025, month::int, 1, 0, 0, 0, ${TZ})
      ), 0)::text as opening_balance,
      COALESCE(SUM(GREATEST(deal_amount - paid_before_close, 0)) FILTER (
        WHERE created_at < make_timestamptz(2025, month::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
      ), 0)::text as closing_balance
    FROM deal_paid
    GROUP BY month
    ORDER BY month`
  );

  console.log('\n=== 2025 Monthly Balances ===');
  for (const r of balance2025) {
    console.log(`  Month ${r.month}: opening=${Number(r.opening_balance).toLocaleString()} | closing=${Number(r.closing_balance).toLocaleString()}`);
  }

  // 3. Current total debt (what dashboard shows)
  const totalDebt = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT
      COALESCE(SUM(d.amount - d.paid_amount), 0)::text as dashboard_debt
    FROM deals d
    WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
      AND d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')`
  );
  console.log('\n=== Dashboard debt (current) ===');
  console.log(`  Dashboard shows: ${Number(totalDebt[0].dashboard_debt).toLocaleString()}`);

  // 4. History-style total debt (all deals, using payments table)
  const histDebt = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT
      COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)), 0)::text as total_debt
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false`
  );
  console.log(`  History total debt: ${Number(histDebt[0].total_debt).toLocaleString()}`);

  // Excel reference:
  console.log('\n=== Excel reference ===');
  console.log('  Dec 2025 closing: 771,709,923');
  console.log('  Feb 2026 closing: 1,013,072,673');
}

main().catch(console.error).finally(() => prisma.$disconnect());
