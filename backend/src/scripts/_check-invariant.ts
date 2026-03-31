import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('==========================================================');
  console.log('  INVARIANT CHECK');
  console.log('==========================================================\n');

  // ---------------------------------------------------------------
  // 1. SUM(payments.amount) vs SUM(deals.paid_amount) for active deals
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

  const sumPayments  = Number(sums.sum_payments);
  const sumPaid      = Number(sums.sum_paid_amount);
  const diff         = Number(sums.diff);
  const match        = diff === 0 ? 'OK' : 'MISMATCH';

  console.log('1) Payments total vs deals.paid_amount (active deals)');
  console.log('------------------------------------------------------------');
  console.log(`   SUM(payments.amount)    = ${sumPayments.toLocaleString()}`);
  console.log(`   SUM(deals.paid_amount)  = ${sumPaid.toLocaleString()}`);
  console.log(`   Difference              = ${diff.toLocaleString()}  [${match}]`);
  console.log();

  // ---------------------------------------------------------------
  // 2. Duplicate payment groups
  //    (same deal_id, amount, method, paid_at  with count > 1)
  // ---------------------------------------------------------------
  const dupes = await prisma.$queryRaw<
    { deal_id: string; amount: string; method: string | null; paid_at: Date; cnt: string }[]
  >(
    Prisma.sql`
      SELECT deal_id,
             amount::text,
             method,
             paid_at,
             COUNT(*)::text AS cnt
      FROM payments
      GROUP BY deal_id, amount, method, paid_at
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `
  );

  console.log(`2) Duplicate payment groups (same deal_id + amount + method + paid_at)`);
  console.log('------------------------------------------------------------');
  console.log(`   Groups found: ${dupes.length}${dupes.length === 20 ? '+' : ''}`);
  if (dupes.length > 0) {
    for (const d of dupes) {
      const paidAt = d.paid_at instanceof Date
        ? d.paid_at.toISOString().slice(0, 19)
        : String(d.paid_at);
      console.log(
        `   deal=${d.deal_id.slice(0, 8)}..  amount=${Number(d.amount).toLocaleString()}  ` +
        `method=${d.method ?? 'NULL'}  paid_at=${paidAt}  x${d.cnt}`
      );
    }
  }
  console.log();

  // ---------------------------------------------------------------
  // 3. Orphaned payments (deal_id NOT in deals table)
  // ---------------------------------------------------------------
  const [orphans] = await prisma.$queryRaw<
    { cnt: string; total_amount: string }[]
  >(
    Prisma.sql`
      SELECT COUNT(*)::text           AS cnt,
             COALESCE(SUM(p.amount), 0)::text AS total_amount
      FROM payments p
      LEFT JOIN deals d ON d.id = p.deal_id
      WHERE d.id IS NULL
    `
  );

  const orphanCount  = Number(orphans.cnt);
  const orphanAmount = Number(orphans.total_amount);

  console.log('3) Orphaned payments (deal_id not in deals)');
  console.log('------------------------------------------------------------');
  console.log(`   Count  = ${orphanCount}`);
  console.log(`   Amount = ${orphanAmount.toLocaleString()}`);
  console.log();

  // ---------------------------------------------------------------
  // 4. Clients where SUM(payments) != SUM(deal.paid_amount)
  // ---------------------------------------------------------------
  const mismatched = await prisma.$queryRaw<
    {
      client_id: string;
      company_name: string;
      sum_payments: string;
      sum_deal_paid: string;
      diff: string;
    }[]
  >(
    Prisma.sql`
      WITH client_payments AS (
        SELECT p.client_id,
               COALESCE(SUM(p.amount), 0) AS sum_payments
        FROM payments p
        GROUP BY p.client_id
      ),
      client_deal_paid AS (
        SELECT d.client_id,
               COALESCE(SUM(d.paid_amount), 0) AS sum_deal_paid
        FROM deals d
        WHERE d.is_archived = false
          AND d.status NOT IN ('CANCELED', 'REJECTED')
        GROUP BY d.client_id
      )
      SELECT
        COALESCE(cp.client_id, cdp.client_id) AS client_id,
        c.company_name,
        COALESCE(cp.sum_payments, 0)::text     AS sum_payments,
        COALESCE(cdp.sum_deal_paid, 0)::text   AS sum_deal_paid,
        (COALESCE(cp.sum_payments, 0)
         - COALESCE(cdp.sum_deal_paid, 0))::text AS diff
      FROM client_payments cp
      FULL OUTER JOIN client_deal_paid cdp
        ON cp.client_id = cdp.client_id
      LEFT JOIN clients c
        ON c.id = COALESCE(cp.client_id, cdp.client_id)
      WHERE COALESCE(cp.sum_payments, 0) != COALESCE(cdp.sum_deal_paid, 0)
      ORDER BY ABS(COALESCE(cp.sum_payments, 0) - COALESCE(cdp.sum_deal_paid, 0)) DESC
      LIMIT 30
    `
  );

  console.log('4) Clients where SUM(payments) != SUM(deal.paid_amount)');
  console.log('------------------------------------------------------------');
  console.log(`   Mismatched clients: ${mismatched.length}${mismatched.length === 30 ? '+' : ''}`);
  if (mismatched.length > 0) {
    for (const m of mismatched) {
      const name = (m.company_name ?? '???').padEnd(30).slice(0, 30);
      console.log(
        `   ${name}  payments=${Number(m.sum_payments).toLocaleString().padStart(15)}  ` +
        `deal_paid=${Number(m.sum_deal_paid).toLocaleString().padStart(15)}  ` +
        `diff=${Number(m.diff).toLocaleString().padStart(15)}`
      );
    }
  }

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log('\n==========================================================');
  console.log('  SUMMARY');
  console.log('==========================================================');
  console.log(`  1) Payments vs paid_amount diff : ${diff === 0 ? 'OK' : diff.toLocaleString()}`);
  console.log(`  2) Duplicate payment groups     : ${dupes.length}${dupes.length === 20 ? '+' : ''}`);
  console.log(`  3) Orphaned payments            : ${orphanCount}`);
  console.log(`  4) Client-level mismatches      : ${mismatched.length}${mismatched.length === 30 ? '+' : ''}`);
  console.log('==========================================================\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
