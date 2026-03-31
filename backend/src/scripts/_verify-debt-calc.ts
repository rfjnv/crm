import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const years = [2021, 2022, 2023, 2024, 2025];

  console.log('=== HISTORICAL DEBT VERIFICATION ===\n');

  for (const year of years) {
    const yearStart = new Date(`${year - 1}-12-31T19:00:00Z`); // Jan 1 00:00 Tashkent
    const yearEnd = new Date(`${year}-12-31T19:00:00Z`);       // Dec 31 23:59 Tashkent

    // NEW algorithm: historical debt from payments table
    const historicalDebt = await prisma.$queryRaw<
      { total_deals: string; total_paid_historical: string; debt_positive: string; overpayments: string; deal_count: string }[]
    >`
      SELECT
        COALESCE(SUM(d.amount), 0)::text as total_deals,
        COALESCE(SUM(COALESCE(hp.paid, 0)), 0)::text as total_paid_historical,
        COALESCE(SUM(GREATEST(d.amount - COALESCE(hp.paid, 0), 0)), 0)::text as debt_positive,
        COALESCE(SUM(GREATEST(COALESCE(hp.paid, 0) - d.amount, 0)), 0)::text as overpayments,
        COUNT(d.id)::text as deal_count
      FROM deals d
      LEFT JOIN (
        SELECT p.deal_id, SUM(p.amount) as paid
        FROM payments p
        WHERE p.paid_at < ${yearEnd}
        GROUP BY p.deal_id
      ) hp ON hp.deal_id = d.id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.created_at < ${yearEnd}
    `;

    // OLD algorithm: using current paid_amount (what was broken)
    const currentDebt = await prisma.$queryRaw<
      { debt_positive: string; overpayments: string }[]
    >`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as debt_positive,
        COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as overpayments
      FROM deals d
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.created_at < ${yearEnd}
    `;

    const h = historicalDebt[0];
    const c = currentDebt[0];

    console.log(`── ${year} ──`);
    console.log(`  Deals count:           ${Number(h.deal_count).toLocaleString()}`);
    console.log(`  Total deal amounts:    ${Number(h.total_deals).toLocaleString()}`);
    console.log(`  Payments until ${year}: ${Number(h.total_paid_historical).toLocaleString()}`);
    console.log(`  ✅ NEW debt (historical): ${Number(h.debt_positive).toLocaleString()}`);
    console.log(`  ✅ NEW overpayments:      ${Number(h.overpayments).toLocaleString()}`);
    console.log(`  ✅ NEW net balance:        ${(Number(h.debt_positive) - Number(h.overpayments)).toLocaleString()}`);
    console.log(`  ❌ OLD debt (current):    ${Number(c.debt_positive).toLocaleString()}`);
    console.log(`  ❌ OLD overpayments:      ${Number(c.overpayments).toLocaleString()}`);
    console.log('');
  }

  // Also check: total payments by year
  console.log('=== PAYMENTS BY YEAR ===\n');
  for (const year of years) {
    const yearStart = new Date(`${year - 1}-12-31T19:00:00Z`);
    const yearEnd = new Date(`${year}-12-31T19:00:00Z`);
    const payments = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as count
      FROM payments p
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
    `;
    console.log(`  ${year}: ${Number(payments[0].total).toLocaleString()} (${payments[0].count} payments)`);
  }

  // Check deals by year
  console.log('\n=== DEALS CREATED BY YEAR ===\n');
  for (const year of years) {
    const yearStart = new Date(`${year - 1}-12-31T19:00:00Z`);
    const yearEnd = new Date(`${year}-12-31T19:00:00Z`);
    const deals = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(d.amount), 0)::text as total, COUNT(*)::text as count
      FROM deals d
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
    `;
    console.log(`  ${year}: ${Number(deals[0].total).toLocaleString()} (${deals[0].count} deals)`);
  }

  // Check Сверка payments impact
  console.log('\n=== СВЕРКА PAYMENTS (excluded from collected but included in debt calc) ===\n');
  const sverka = await prisma.$queryRaw<{ year_paid: number; total: string; count: string }[]>`
    SELECT EXTRACT(YEAR FROM p.paid_at)::int as year_paid,
      COALESCE(SUM(p.amount), 0)::text as total,
      COUNT(*)::text as count
    FROM payments p
    WHERE p.note LIKE 'Сверка%'
    GROUP BY EXTRACT(YEAR FROM p.paid_at)
    ORDER BY year_paid
  `;
  for (const s of sverka) {
    console.log(`  ${s.year_paid}: ${Number(s.total).toLocaleString()} (${s.count} payments)`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
