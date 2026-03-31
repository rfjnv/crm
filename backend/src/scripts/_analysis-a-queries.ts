/**
 * Section A: Three SQL queries comparing Dashboard / History / Excel metrics.
 * READ-ONLY — no INSERT/UPDATE/DELETE.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== SECTION A: SQL QUERIES ===\n');

  // Query 1: Dashboard debt
  const q1 = await prisma.$queryRaw<{ dashboard_debt: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(d.amount - d.paid_amount),0)::text AS dashboard_debt
    FROM deals d
    WHERE d.payment_status IN ('UNPAID','PARTIAL')
      AND d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')`
  );
  console.log(`Q1 Dashboard debt (UNPAID+PARTIAL): ${Number(q1[0].dashboard_debt).toLocaleString('ru-RU')}`);

  // Query 2: History-style closing balance at 2026-02-28
  const q2 = await prisma.$queryRaw<{ history_closing: string }[]>(
    Prisma.sql`
    WITH deal_payments AS (
      SELECT d.id AS deal_id, d.amount AS deal_amount,
             COALESCE(SUM(p.amount) FILTER (WHERE p.paid_at < DATE '2026-03-01'), 0) AS paid_before
      FROM deals d
      LEFT JOIN payments p ON p.deal_id = d.id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
      GROUP BY d.id, d.amount
    )
    SELECT SUM(GREATEST(deal_amount - paid_before, 0))::text AS history_closing
    FROM deal_payments`
  );
  console.log(`Q2 History closing (2026-02-28):     ${Number(q2[0].history_closing).toLocaleString('ru-RU')}`);

  // Query 3: CRM-equivalent closing (using deal.paid_amount directly)
  const q3 = await prisma.$queryRaw<{ crm_closing: string }[]>(
    Prisma.sql`
    SELECT SUM(GREATEST(d.amount - COALESCE(d.paid_amount, 0), 0))::text AS crm_closing
    FROM deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')`
  );
  console.log(`Q3 CRM closing (deal.paid_amount):   ${Number(q3[0].crm_closing).toLocaleString('ru-RU')}`);

  // 20-row sample: clients with biggest difference between history-style and CRM-style debt
  console.log('\n=== 20-ROW SAMPLE: history vs CRM per client ===');
  const sample = await prisma.$queryRaw<{
    company_name: string;
    deal_count: string;
    crm_gross: string;
    history_gross: string;
    diff: string;
    total_payments: string;
    sync_payments: string;
  }[]>(
    Prisma.sql`
    WITH per_deal AS (
      SELECT d.id, d.client_id, d.amount AS deal_amount,
             COALESCE(d.paid_amount, 0) AS crm_paid,
             COALESCE(SUM(p.amount) FILTER (WHERE p.paid_at < DATE '2026-03-01'), 0) AS history_paid,
             COUNT(p.id) FILTER (WHERE p.note LIKE '%Сверка CRM%') AS sync_cnt
      FROM deals d
      LEFT JOIN payments p ON p.deal_id = d.id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
      GROUP BY d.id
    )
    SELECT c.company_name,
           COUNT(pd.id)::text AS deal_count,
           SUM(GREATEST(pd.deal_amount - pd.crm_paid, 0))::text AS crm_gross,
           SUM(GREATEST(pd.deal_amount - pd.history_paid, 0))::text AS history_gross,
           (SUM(GREATEST(pd.deal_amount - pd.history_paid, 0)) - SUM(GREATEST(pd.deal_amount - pd.crm_paid, 0)))::text AS diff,
           SUM(pd.history_paid)::text AS total_payments,
           SUM(pd.sync_cnt)::text AS sync_payments
    FROM per_deal pd
    JOIN clients c ON c.id = pd.client_id
    GROUP BY c.id, c.company_name
    HAVING ABS(SUM(GREATEST(pd.deal_amount - pd.history_paid, 0)) - SUM(GREATEST(pd.deal_amount - pd.crm_paid, 0))) > 100
    ORDER BY ABS(SUM(GREATEST(pd.deal_amount - pd.history_paid, 0)) - SUM(GREATEST(pd.deal_amount - pd.crm_paid, 0))) DESC
    LIMIT 20`
  );

  console.log(`${'Client'.padEnd(35)} ${'Deals'.padStart(5)} ${'CRM_Gross'.padStart(15)} ${'Hist_Gross'.padStart(15)} ${'Diff'.padStart(15)} ${'TotalPaid'.padStart(15)} ${'SyncPay'.padStart(7)}`);
  console.log('-'.repeat(110));
  for (const r of sample) {
    console.log(
      `${r.company_name.padEnd(35)} ${r.deal_count.padStart(5)} ${Number(r.crm_gross).toLocaleString('ru-RU').padStart(15)} ${Number(r.history_gross).toLocaleString('ru-RU').padStart(15)} ${Number(r.diff).toLocaleString('ru-RU').padStart(15)} ${Number(r.total_payments).toLocaleString('ru-RU').padStart(15)} ${r.sync_payments.padStart(7)}`
    );
  }

  // Additional: count deals with NO payments at all
  const noPay = await prisma.$queryRaw<{ cnt: string; total: string }[]>(
    Prisma.sql`
    SELECT COUNT(*)::text AS cnt, COALESCE(SUM(d.amount),0)::text AS total
    FROM deals d
    LEFT JOIN payments p ON p.deal_id = d.id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
      AND p.id IS NULL
      AND d.amount > 0`
  );
  console.log(`\nDeals with NO payments: ${noPay[0].cnt}, total amount: ${Number(noPay[0].total).toLocaleString('ru-RU')}`);

  // Sum of all payments vs sum of all deal.paid_amount
  const payVsPaid = await prisma.$queryRaw<{ sum_payments: string; sum_paid_amount: string }[]>(
    Prisma.sql`
    SELECT
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p
       JOIN deals d ON d.id = p.deal_id
       WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED'))::text AS sum_payments,
      (SELECT COALESCE(SUM(d.paid_amount),0) FROM deals d
       WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED'))::text AS sum_paid_amount`
  );
  console.log(`\nSUM(payments.amount) for active deals: ${Number(payVsPaid[0].sum_payments).toLocaleString('ru-RU')}`);
  console.log(`SUM(deals.paid_amount) for active deals: ${Number(payVsPaid[0].sum_paid_amount).toLocaleString('ru-RU')}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
