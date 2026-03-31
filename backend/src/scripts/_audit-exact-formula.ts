import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== EXACT FORMULA: SUM(deals) - SUM(payments) until yearEnd ===');
  console.log('Excel: 2024 = 1,125,627,628 | 2025 = 916,433,945\n');

  const years = [2024, 2025];

  for (const year of years) {
    const yearEnd = new Date(`${year}-12-31T19:00:00Z`); // Jan 1 next year 00:00 Tashkent

    console.log(`\n══════ ${year} (cutoff: ${yearEnd.toISOString()}) ══════\n`);

    // ═══ DEALS side ═══
    // 1a. ALL deals, zero filters
    const d1 = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as count
      FROM deals WHERE created_at < ${yearEnd}`;

    // 1b. Non-archived only
    const d2 = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as count
      FROM deals WHERE created_at < ${yearEnd} AND is_archived = false`;

    // 1c. Non-archived, non-canceled/rejected
    const d3 = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as count
      FROM deals WHERE created_at < ${yearEnd} AND is_archived = false AND status NOT IN ('CANCELED','REJECTED')`;

    // 1d. Including archived but excluding canceled
    const d4 = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as count
      FROM deals WHERE created_at < ${yearEnd} AND status NOT IN ('CANCELED','REJECTED')`;

    console.log('DEALS:');
    console.log(`  All deals:                   ${Number(d1[0].total).toLocaleString()} (${d1[0].count})`);
    console.log(`  Non-archived:                ${Number(d2[0].total).toLocaleString()} (${d2[0].count})`);
    console.log(`  Non-archived, non-canceled:  ${Number(d3[0].total).toLocaleString()} (${d3[0].count})`);
    console.log(`  Non-canceled (incl archived): ${Number(d4[0].total).toLocaleString()} (${d4[0].count})`);

    // ═══ PAYMENTS side ═══
    // 2a. ALL payments, zero filters
    const p1 = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as count
      FROM payments WHERE paid_at < ${yearEnd}`;

    // 2b. Excluding Сверка
    const p2 = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as count
      FROM payments WHERE paid_at < ${yearEnd} AND (note IS NULL OR note NOT LIKE 'Сверка%')`;

    // 2c. Only Сверка
    const p3 = await prisma.$queryRaw<{ total: string; count: string }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::text as count
      FROM payments WHERE paid_at < ${yearEnd} AND note LIKE 'Сверка%'`;

    console.log('\nPAYMENTS:');
    console.log(`  All payments:      ${Number(p1[0].total).toLocaleString()} (${p1[0].count})`);
    console.log(`  Excl Сверка:       ${Number(p2[0].total).toLocaleString()} (${p2[0].count})`);
    console.log(`  Only Сверка:       ${Number(p3[0].total).toLocaleString()} (${p3[0].count})`);

    // ═══ COMBINATIONS ═══
    const deals_all = Number(d1[0].total);
    const deals_noarch = Number(d2[0].total);
    const deals_noarch_nocanc = Number(d3[0].total);
    const deals_nocanc = Number(d4[0].total);
    const pay_all = Number(p1[0].total);
    const pay_nosverka = Number(p2[0].total);

    const fmt = (n: number) => Math.round(n).toLocaleString();
    const target = year === 2024 ? 1125627628 : 916433945;

    console.log('\nCOMBINATIONS (deals - payments):');
    const combos = [
      { name: 'All deals - All payments', val: deals_all - pay_all },
      { name: 'All deals - No-Сверка payments', val: deals_all - pay_nosverka },
      { name: 'Non-archived - All payments', val: deals_noarch - pay_all },
      { name: 'Non-archived - No-Сверка', val: deals_noarch - pay_nosverka },
      { name: 'Non-arch/canc - All payments', val: deals_noarch_nocanc - pay_all },
      { name: 'Non-arch/canc - No-Сверка', val: deals_noarch_nocanc - pay_nosverka },
      { name: 'Non-canceled - All payments', val: deals_nocanc - pay_all },
      { name: 'Non-canceled - No-Сверка', val: deals_nocanc - pay_nosverka },
    ];

    for (const c of combos) {
      const diff = Math.abs(c.val - target);
      const match = diff < 1000 ? ' ✅ MATCH!' : diff < 100_000_000 ? ' ← close' : '';
      console.log(`  ${c.name.padEnd(40)} ${fmt(c.val)}${match}`);
    }
    console.log(`  ${'EXCEL TARGET'.padEnd(40)} ${fmt(target)}`);
  }

  // Check: are there negative payments or negative deal amounts?
  console.log('\n=== EDGE CASES ===');
  const negPayments = await prisma.$queryRaw<{ count: string; total: string }[]>`
    SELECT COUNT(*)::text as count, COALESCE(SUM(amount), 0)::text as total
    FROM payments WHERE amount < 0`;
  console.log(`Negative payments: ${negPayments[0].count} totaling ${Number(negPayments[0].total).toLocaleString()}`);

  const negDeals = await prisma.$queryRaw<{ count: string; total: string }[]>`
    SELECT COUNT(*)::text as count, COALESCE(SUM(amount), 0)::text as total
    FROM deals WHERE amount < 0`;
  console.log(`Negative deals: ${negDeals[0].count} totaling ${Number(negDeals[0].total).toLocaleString()}`);

  const zeroDeals = await prisma.$queryRaw<{ count: string }[]>`
    SELECT COUNT(*)::text as count FROM deals WHERE amount = 0`;
  console.log(`Zero-amount deals: ${zeroDeals[0].count}`);

  // Check canceled/rejected deal amounts
  const canceledAmounts = await prisma.$queryRaw<{ count: string; total: string }[]>`
    SELECT COUNT(*)::text as count, COALESCE(SUM(amount), 0)::text as total
    FROM deals WHERE status IN ('CANCELED','REJECTED')`;
  console.log(`Canceled/rejected deals: ${canceledAmounts[0].count} totaling ${Number(canceledAmounts[0].total).toLocaleString()}`);

  const archivedAmounts = await prisma.$queryRaw<{ count: string; total: string }[]>`
    SELECT COUNT(*)::text as count, COALESCE(SUM(amount), 0)::text as total
    FROM deals WHERE is_archived = true`;
  console.log(`Archived deals: ${archivedAmounts[0].count} totaling ${Number(archivedAmounts[0].total).toLocaleString()}`);

  // Check: payments on archived/canceled deals
  const payOnCanceled = await prisma.$queryRaw<{ count: string; total: string }[]>`
    SELECT COUNT(p.id)::text as count, COALESCE(SUM(p.amount), 0)::text as total
    FROM payments p JOIN deals d ON d.id = p.deal_id
    WHERE d.status IN ('CANCELED','REJECTED')`;
  console.log(`Payments on canceled deals: ${payOnCanceled[0].count} totaling ${Number(payOnCanceled[0].total).toLocaleString()}`);

  const payOnArchived = await prisma.$queryRaw<{ count: string; total: string }[]>`
    SELECT COUNT(p.id)::text as count, COALESCE(SUM(p.amount), 0)::text as total
    FROM payments p JOIN deals d ON d.id = p.deal_id
    WHERE d.is_archived = true`;
  console.log(`Payments on archived deals: ${payOnArchived[0].count} totaling ${Number(payOnArchived[0].total).toLocaleString()}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
