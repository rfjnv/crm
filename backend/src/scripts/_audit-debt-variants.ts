import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== DEBT AUDIT: matching Excel values ===');
  console.log('Excel reference: 2024 = 1,125,627,628 | 2025 = 916,433,945\n');

  const years = [2024, 2025];

  for (const year of years) {
    const yearStart = new Date(`${year - 1}-12-31T19:00:00Z`);
    const yearEnd = new Date(`${year}-12-31T19:00:00Z`);

    console.log(`\n══════════ ${year} ══════════\n`);

    // 1. Year-specific deals only (created in this year)
    const yearDeals = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(d.amount), 0)::text as total, COUNT(*)::text as count
      FROM deals d
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    `;

    // 2. Payments ON year-specific deals, made within the same year
    const yearPaymentsOnYearDeals = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as count
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
    `;

    // 3. ALL payments on year-specific deals (ever, including future years)
    const allPaymentsOnYearDeals = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as count
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    `;

    // 4. Payments on year deals up to yearEnd (historical)
    const histPaymentsOnYearDeals = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as count
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND p.paid_at < ${yearEnd}
    `;

    // 5. Current paid_amount for year deals
    const currentPaid = await prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(d.paid_amount), 0)::text as total
      FROM deals d
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    `;

    // 6. Same-year payments excluding Сверка
    const yearPaymentsNoSverka = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as count
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
        AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
    `;

    // 7 Historical payments excluding Сверка
    const histPaymentsNoSverka = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as count
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND p.paid_at < ${yearEnd}
        AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
    `;

    // 8. Cumulative (all deals up to yearEnd) - NEW algorithm
    const cumulativeDebt = await prisma.$queryRaw<{ debt: string; overpay: string }[]>`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - COALESCE(hp.paid, 0), 0)), 0)::text as debt,
        COALESCE(SUM(GREATEST(COALESCE(hp.paid, 0) - d.amount, 0)), 0)::text as overpay
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

    // 9. Year-specific debt with GREATEST (positive only)
    const yearSpecificDebt = await prisma.$queryRaw<{ debt: string; overpay: string }[]>`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - COALESCE(hp.paid, 0), 0)), 0)::text as debt,
        COALESCE(SUM(GREATEST(COALESCE(hp.paid, 0) - d.amount, 0)), 0)::text as overpay
      FROM deals d
      LEFT JOIN (
        SELECT p.deal_id, SUM(p.amount) as paid
        FROM payments p
        WHERE p.paid_at < ${yearEnd}
        GROUP BY p.deal_id
      ) hp ON hp.deal_id = d.id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
    `;

    // 10. All payments in the year (not deal-filtered)
    const allPaymentsInYear = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as count
      FROM payments p
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
    `;
    const allPaymentsNoSverkaInYear = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(p.amount), 0)::text as total, COUNT(*)::text as count
      FROM payments p
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
        AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
    `;

    const d = Number(yearDeals[0].total);
    const fmt = (n: number) => Math.round(n).toLocaleString();

    console.log(`Deals in ${year}: ${fmt(d)} (${yearDeals[0].count} deals)`);
    console.log('');
    console.log('--- Variant calculations ---');

    // Variant A: year deals - payments on year deals in same year
    const vA = d - Number(yearPaymentsOnYearDeals[0].total);
    console.log(`A) Year deals - same-year payments on them:        ${fmt(vA)}`);

    // Variant B: year deals - all payments on year deals ever
    const vB = d - Number(allPaymentsOnYearDeals[0].total);
    console.log(`B) Year deals - ALL payments on them (ever):       ${fmt(vB)}`);

    // Variant C: year deals - historical payments on year deals
    const vC = d - Number(histPaymentsOnYearDeals[0].total);
    console.log(`C) Year deals - hist payments on them (≤yearEnd):  ${fmt(vC)}`);

    // Variant D: year deals - current paid_amount
    const vD = d - Number(currentPaid[0].total);
    console.log(`D) Year deals - current paid_amount:               ${fmt(vD)}`);

    // Variant E: year deals - same-year payments excl Сверка
    const vE = d - Number(yearPaymentsNoSverka[0].total);
    console.log(`E) Year deals - same-year no-Сверка:               ${fmt(vE)}`);

    // Variant F: year deals - hist payments excl Сверка
    const vF = d - Number(histPaymentsNoSverka[0].total);
    console.log(`F) Year deals - hist no-Сверка (≤yearEnd):         ${fmt(vF)}`);

    // Variant G: Cumulative GREATEST debt
    console.log(`G) Cumulative debt (GREATEST, all deals ≤yearEnd): ${fmt(Number(cumulativeDebt[0].debt))}`);

    // Variant H: Year-specific GREATEST debt
    console.log(`H) Year-specific debt (GREATEST, year deals):      ${fmt(Number(yearSpecificDebt[0].debt))}`);

    // Variant I: Cumulative net = debt - overpay
    const vI = Number(cumulativeDebt[0].debt) - Number(cumulativeDebt[0].overpay);
    console.log(`I) Cumulative net (debt - overpay):                ${fmt(vI)}`);

    // Variant J: Year-specific net = debt - overpay
    const vJ = Number(yearSpecificDebt[0].debt) - Number(yearSpecificDebt[0].overpay);
    console.log(`J) Year-specific net (debt - overpay):             ${fmt(vJ)}`);

    // Variant K: all year payments - year deals (flow)
    const vK = d - Number(allPaymentsInYear[0].total);
    console.log(`K) Year deals - ALL payments in year:              ${fmt(vK)}`);

    // Variant L: all year payments excl sverka - year deals
    const vL = d - Number(allPaymentsNoSverkaInYear[0].total);
    console.log(`L) Year deals - ALL payments in year (no Сверка):  ${fmt(vL)}`);

    console.log(`\n   Excel target: ${year === 2024 ? '1,125,627,628' : '916,433,945'}`);
    console.log('');
  }

  // Also check 2026 payments that might affect historical numbers
  console.log('\n=== 2026 payments (Q1 2026 so far) ===');
  const pay2026 = await prisma.$queryRaw<{ total: string; count: string; sverka_total: string; sverka_count: string }[]>`
    SELECT
      COALESCE(SUM(p.amount), 0)::text as total,
      COUNT(*)::text as count,
      COALESCE(SUM(p.amount) FILTER (WHERE p.note LIKE 'Сверка%'), 0)::text as sverka_total,
      COUNT(*) FILTER (WHERE p.note LIKE 'Сверка%')::text as sverka_count
    FROM payments p
    WHERE p.paid_at >= '2025-12-31T19:00:00Z'
  `;
  console.log(`  Total: ${Number(pay2026[0].total).toLocaleString()} (${pay2026[0].count} payments)`);
  console.log(`  Сверка: ${Number(pay2026[0].sverka_total).toLocaleString()} (${pay2026[0].sverka_count} payments)`);
  console.log(`  Non-Сверка: ${(Number(pay2026[0].total) - Number(pay2026[0].sverka_total)).toLocaleString()}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
