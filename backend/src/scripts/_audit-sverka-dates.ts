import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== СВЕРКА PAYMENTS ANALYSIS: which year do they belong to? ===\n');

  // Сверка payments grouped by DEAL creation year vs PAYMENT year
  const sverkaByYears = await prisma.$queryRaw<
    { deal_year: number; payment_year: number; total: string; count: string }[]
  >`
    SELECT
      EXTRACT(YEAR FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as deal_year,
      EXTRACT(YEAR FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as payment_year,
      SUM(p.amount)::text as total,
      COUNT(*)::text as count
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    WHERE p.note LIKE 'Сверка%'
    GROUP BY deal_year, payment_year
    ORDER BY deal_year, payment_year
  `;

  console.log('Сверка payments: deal_year → payment_year\n');
  console.log('Deal Year | Payment Year | Amount           | Count');
  console.log('----------|--------------|------------------|------');
  for (const r of sverkaByYears) {
    const mismatch = r.deal_year !== r.payment_year ? ' ⚠️ MISMATCH' : '';
    console.log(`    ${r.deal_year}  |      ${r.payment_year}   | ${Number(r.total).toLocaleString().padStart(16)} | ${r.count}${mismatch}`);
  }

  // ALL payments grouped by deal year vs payment year (not just Сверка)
  console.log('\n\n=== ALL PAYMENTS: deal_year vs payment_year ===\n');
  const allByYears = await prisma.$queryRaw<
    { deal_year: number; payment_year: number; total: string; count: string; is_sverka: boolean }[]
  >`
    SELECT
      EXTRACT(YEAR FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as deal_year,
      EXTRACT(YEAR FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as payment_year,
      CASE WHEN p.note LIKE 'Сверка%' THEN true ELSE false END as is_sverka,
      SUM(p.amount)::text as total,
      COUNT(*)::text as count
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    GROUP BY deal_year, payment_year, is_sverka
    ORDER BY deal_year, payment_year, is_sverka
  `;

  console.log('Deal Year | Pay Year | Сверка? | Amount           | Count');
  console.log('----------|----------|--------|------------------|------');
  for (const r of allByYears) {
    const mismatch = r.deal_year !== r.payment_year ? ' ⚠️' : '';
    console.log(`    ${r.deal_year}  |    ${r.payment_year}  |   ${r.is_sverka ? 'YES' : ' NO'}  | ${Number(r.total).toLocaleString().padStart(16)} | ${r.count}${mismatch}`);
  }

  // Test the hypothesis: debt = deals - (non-Сверка by paid_at + ALL Сверка on qualifying deals)
  console.log('\n\n=== TESTING: Сверка assigned to deal year ===\n');
  const years = [2024, 2025];
  for (const year of years) {
    const yearEnd = new Date(`${year}-12-31T19:00:00Z`);

    // Non-Сверка payments by paid_at
    const nonSverka = await prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total
      FROM payments p
      WHERE p.paid_at < ${yearEnd}
        AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
    `;

    // ALL Сверка on deals created before yearEnd (regardless of payment date)
    const sverkaOnDeals = await prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE d.created_at < ${yearEnd}
        AND p.note LIKE 'Сверка%'
    `;

    // Deals
    const deals = await prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total
      FROM deals WHERE created_at < ${yearEnd}
        AND is_archived = false AND status NOT IN ('CANCELED','REJECTED')
    `;

    // Also try: Сверка only on deals where deal_year <= analysis year
    const sverkaByDealYear = await prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE EXTRACT(YEAR FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent') <= ${year}
        AND p.note LIKE 'Сверка%'
    `;

    const d = Number(deals[0].total);
    const ns = Number(nonSverka[0].total);
    const sv = Number(sverkaOnDeals[0].total);
    const svby = Number(sverkaByDealYear[0].total);
    const target = year === 2024 ? 1125627628 : 916433945;

    console.log(`── ${year} ──`);
    console.log(`  Deals:                    ${d.toLocaleString()}`);
    console.log(`  Non-Сверка (by paid_at):  ${ns.toLocaleString()}`);
    console.log(`  ALL Сверка on deals:      ${sv.toLocaleString()}`);
    console.log(`  Сверка (deal_year≤${year}): ${svby.toLocaleString()}`);
    console.log(`  `);
    console.log(`  Deals - NonSverka - AllSverka:     ${(d - ns - sv).toLocaleString()}`);
    console.log(`  Deals - NonSverka - SverkaByYear:  ${(d - ns - svby).toLocaleString()}`);
    console.log(`  Deals - NonSverka:                 ${(d - ns).toLocaleString()}`);
    console.log(`  EXCEL TARGET:                      ${target.toLocaleString()}\n`);
  }

  // Check: non-Сверка payments in 2026 broken down by deal year
  console.log('\n=== 2026 NON-СВЕРКА payments by deal year ===');
  const nonSverka2026 = await prisma.$queryRaw<
    { deal_year: number; total: string; count: string }[]
  >`
    SELECT
      EXTRACT(YEAR FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as deal_year,
      SUM(p.amount)::text as total,
      COUNT(*)::text as count
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    WHERE p.paid_at >= '2025-12-31T19:00:00Z'
      AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
    GROUP BY deal_year
    ORDER BY deal_year
  `;
  for (const r of nonSverka2026) {
    console.log(`  Deals from ${r.deal_year}: ${Number(r.total).toLocaleString()} (${r.count} payments)`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
