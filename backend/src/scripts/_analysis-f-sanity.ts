/**
 * Section F: Sanity checks — payment mismatches, future dates, duplicates.
 * READ-ONLY — no INSERT/UPDATE/DELETE.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== SECTION F: SANITY CHECKS ===\n');

  // F1: Deals where SUM(payments) != deal.paid_amount
  console.log('--- F1: payment sum vs deal.paid_amount mismatches ---');
  const mismatches = await prisma.$queryRaw<{
    deal_id: string;
    company_name: string;
    deal_amount: string;
    paid_amount: string;
    sum_payments: string;
    diff: string;
    payment_count: string;
  }[]>(
    Prisma.sql`
    SELECT d.id AS deal_id, c.company_name,
           d.amount::text AS deal_amount,
           d.paid_amount::text AS paid_amount,
           COALESCE(SUM(p.amount),0)::text AS sum_payments,
           (d.paid_amount - COALESCE(SUM(p.amount),0))::text AS diff,
           COUNT(p.id)::text AS payment_count
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN payments p ON p.deal_id = d.id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY d.id, c.company_name
    HAVING ABS(d.paid_amount - COALESCE(SUM(p.amount),0)) > 1
    ORDER BY ABS(d.paid_amount - COALESCE(SUM(p.amount),0)) DESC
    LIMIT 30`
  );
  console.log(`Found ${mismatches.length} mismatches (showing top 30):`);
  if (mismatches.length > 0) {
    console.log(`${'Client'.padEnd(30)} ${'DealAmt'.padStart(12)} ${'PaidAmt'.padStart(12)} ${'SumPay'.padStart(12)} ${'Diff'.padStart(12)} ${'#Pay'.padStart(5)}`);
    for (const m of mismatches) {
      console.log(
        `${m.company_name.substring(0, 30).padEnd(30)} ${Number(m.deal_amount).toLocaleString('ru-RU').padStart(12)} ${Number(m.paid_amount).toLocaleString('ru-RU').padStart(12)} ${Number(m.sum_payments).toLocaleString('ru-RU').padStart(12)} ${Number(m.diff).toLocaleString('ru-RU').padStart(12)} ${m.payment_count.padStart(5)}`
      );
    }
  }

  // F2: Future-dated payments (paid_at > today)
  console.log('\n--- F2: Future-dated payments (paid_at > 2026-03-03) ---');
  const futurePayments = await prisma.$queryRaw<{
    id: string;
    company_name: string;
    amount: string;
    paid_at: string;
    note: string;
  }[]>(
    Prisma.sql`
    SELECT p.id, c.company_name, p.amount::text,
           p.paid_at::text,
           COALESCE(p.note, '') AS note
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    WHERE p.paid_at > DATE '2026-03-03'
    ORDER BY p.paid_at DESC
    LIMIT 20`
  );
  console.log(`Found ${futurePayments.length} future-dated payments:`);
  for (const fp of futurePayments) {
    console.log(`  ${fp.company_name.substring(0, 30).padEnd(30)} ${Number(fp.amount).toLocaleString('ru-RU').padStart(12)} paid_at=${fp.paid_at.substring(0, 10)} note="${fp.note.substring(0, 40)}"`);
  }

  // F3: Duplicate payments (same deal_id, same amount, same date)
  console.log('\n--- F3: Potential duplicate payments ---');
  const dupes = await prisma.$queryRaw<{
    deal_id: string;
    company_name: string;
    amount: string;
    paid_date: string;
    cnt: string;
  }[]>(
    Prisma.sql`
    SELECT p.deal_id, c.company_name, p.amount::text,
           p.paid_at::date::text AS paid_date,
           COUNT(*)::text AS cnt
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
    GROUP BY p.deal_id, c.company_name, p.amount, p.paid_at::date
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, p.amount DESC
    LIMIT 20`
  );
  console.log(`Found ${dupes.length} potential duplicate groups:`);
  for (const dp of dupes) {
    console.log(`  ${dp.company_name.substring(0, 30).padEnd(30)} deal=${dp.deal_id.substring(0, 8)} amount=${Number(dp.amount).toLocaleString('ru-RU').padStart(12)} date=${dp.paid_date} count=${dp.cnt}`);
  }

  // F4: Deals with paid_amount > amount (overpaid)
  console.log('\n--- F4: Overpaid deals (paid_amount > amount) ---');
  const overpaid = await prisma.$queryRaw<{
    deal_id: string;
    company_name: string;
    amount: string;
    paid_amount: string;
    excess: string;
  }[]>(
    Prisma.sql`
    SELECT d.id AS deal_id, c.company_name,
           d.amount::text, d.paid_amount::text,
           (d.paid_amount - d.amount)::text AS excess
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
      AND d.paid_amount > d.amount + 1
    ORDER BY (d.paid_amount - d.amount) DESC
    LIMIT 20`
  );
  console.log(`Found ${overpaid.length} overpaid deals:`);
  for (const op of overpaid) {
    console.log(`  ${op.company_name.substring(0, 30).padEnd(30)} amount=${Number(op.amount).toLocaleString('ru-RU').padStart(12)} paid=${Number(op.paid_amount).toLocaleString('ru-RU').padStart(12)} excess=${Number(op.excess).toLocaleString('ru-RU').padStart(12)}`);
  }

  // F5: Sync payments date distribution
  console.log('\n--- F5: Sync payments date distribution ---');
  const syncDates = await prisma.$queryRaw<{
    month: string;
    cnt: string;
    total: string;
  }[]>(
    Prisma.sql`
    SELECT TO_CHAR(p.paid_at, 'YYYY-MM') AS month,
           COUNT(*)::text AS cnt,
           SUM(p.amount)::text AS total
    FROM payments p
    WHERE p.note LIKE '%Сверка CRM%'
    GROUP BY TO_CHAR(p.paid_at, 'YYYY-MM')
    ORDER BY month`
  );
  console.log(`Sync payments by month:`);
  for (const sd of syncDates) {
    console.log(`  ${sd.month} — ${sd.cnt} payments, total ${Number(sd.total).toLocaleString('ru-RU')}`);
  }

  // F6: Payment status consistency
  console.log('\n--- F6: Payment status consistency ---');
  const statusIssues = await prisma.$queryRaw<{
    issue: string;
    cnt: string;
  }[]>(
    Prisma.sql`
    SELECT 'PAID but paid_amount < amount' AS issue, COUNT(*)::text AS cnt
    FROM deals WHERE is_archived = false AND payment_status = 'PAID' AND paid_amount < amount - 1
    UNION ALL
    SELECT 'UNPAID but paid_amount > 0' AS issue, COUNT(*)::text AS cnt
    FROM deals WHERE is_archived = false AND payment_status = 'UNPAID' AND paid_amount > 1
    UNION ALL
    SELECT 'PARTIAL but paid_amount >= amount' AS issue, COUNT(*)::text AS cnt
    FROM deals WHERE is_archived = false AND payment_status = 'PARTIAL' AND paid_amount >= amount
    UNION ALL
    SELECT 'PARTIAL but paid_amount = 0' AS issue, COUNT(*)::text AS cnt
    FROM deals WHERE is_archived = false AND payment_status = 'PARTIAL' AND paid_amount < 1`
  );
  console.log('Payment status consistency:');
  for (const si of statusIssues) {
    console.log(`  ${si.issue}: ${si.cnt}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
