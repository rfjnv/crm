/**
 * fix-paid-amounts.ts
 *
 * Recalculates deal.paidAmount from actual SUM(payments.amount)
 * and fixes paymentStatus accordingly.
 *
 * Usage:
 *   DRY RUN (default):  npx tsx src/scripts/fix-paid-amounts.ts
 *   APPLY:              npx tsx src/scripts/fix-paid-amounts.ts --apply
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

interface MismatchRow {
  id: string;
  title: string;
  amount: string;
  paid_amount: string;
  sum_payments: string;
  diff: string;
  status: string;
  payment_status: string;
}

async function main() {
  console.log(`\n=== fix-paid-amounts ${APPLY ? '*** APPLY MODE ***' : '(dry run)'} ===\n`);

  // 1. Find all deals where paidAmount != SUM(payments)
  const mismatches = await prisma.$queryRaw<MismatchRow[]>`
    SELECT
      d.id, d.title, d.amount::text, d.paid_amount::text, d.status, d.payment_status,
      COALESCE(hp.total_payments, 0)::text as sum_payments,
      (d.paid_amount - COALESCE(hp.total_payments, 0))::text as diff
    FROM deals d
    LEFT JOIN (
      SELECT p.deal_id, SUM(p.amount) as total_payments
      FROM payments p
      GROUP BY p.deal_id
    ) hp ON hp.deal_id = d.id
    WHERE ABS(d.paid_amount - COALESCE(hp.total_payments, 0)) > 0.01
  `;

  console.log(`Found ${mismatches.length} deals with paidAmount mismatch\n`);

  if (mismatches.length === 0) {
    console.log('Nothing to fix!');
    return;
  }

  // 2. Show summary
  let totalDiffPositive = 0; // paidAmount > payments (inflated)
  let totalDiffNegative = 0; // paidAmount < payments (deflated)
  for (const r of mismatches) {
    const diff = Number(r.diff);
    if (diff > 0) totalDiffPositive += diff;
    else totalDiffNegative += Math.abs(diff);
  }

  console.log(`  paidAmount HIGHER than real payments (inflated debt reduction): ${totalDiffPositive.toLocaleString()}`);
  console.log(`  paidAmount LOWER  than real payments (deflated debt reduction): ${totalDiffNegative.toLocaleString()}`);
  console.log(`  Net overcount in paidAmount: ${(totalDiffPositive - totalDiffNegative).toLocaleString()}\n`);

  // 3. Show top 20 biggest mismatches
  const sorted = [...mismatches].sort((a, b) => Math.abs(Number(b.diff)) - Math.abs(Number(a.diff)));
  console.log('Top 20 mismatches:');
  console.log('  Title                           | Amount        | paidAmount    | SUM(payments) | Diff');
  console.log('  --------------------------------|---------------|---------------|---------------|--------');
  for (const r of sorted.slice(0, 20)) {
    const title = r.title.substring(0, 32).padEnd(32);
    console.log(`  ${title} | ${Number(r.amount).toLocaleString().padStart(13)} | ${Number(r.paid_amount).toLocaleString().padStart(13)} | ${Number(r.sum_payments).toLocaleString().padStart(13)} | ${Number(r.diff).toLocaleString()}`);
  }

  // 4. Calculate what debt totals will look like BEFORE and AFTER
  const beforeDebt = await prisma.$queryRaw<{ debt: string }[]>`
    SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt
    FROM deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND (d.amount - d.paid_amount) > 0
  `;

  const afterDebt = await prisma.$queryRaw<{ debt: string }[]>`
    SELECT COALESCE(SUM(d.amount - COALESCE(hp.total_payments, 0)), 0)::text as debt
    FROM deals d
    LEFT JOIN (
      SELECT p.deal_id, SUM(p.amount) as total_payments
      FROM payments p
      GROUP BY p.deal_id
    ) hp ON hp.deal_id = d.id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND (d.amount - COALESCE(hp.total_payments, 0)) > 0
  `;

  const beforePrepay = await prisma.$queryRaw<{ prepay: string }[]>`
    SELECT COALESCE(SUM(d.paid_amount - d.amount), 0)::text as prepay
    FROM deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND d.paid_amount > d.amount
  `;

  const afterPrepay = await prisma.$queryRaw<{ prepay: string }[]>`
    SELECT COALESCE(SUM(COALESCE(hp.total_payments, 0) - d.amount), 0)::text as prepay
    FROM deals d
    LEFT JOIN (
      SELECT p.deal_id, SUM(p.amount) as total_payments
      FROM payments p
      GROUP BY p.deal_id
    ) hp ON hp.deal_id = d.id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND COALESCE(hp.total_payments, 0) > d.amount
  `;

  console.log('\n\n=== DEBT TOTALS COMPARISON ===\n');
  console.log(`  BEFORE fix (current paidAmount):`);
  console.log(`    Gross debt:   ${Number(beforeDebt[0].debt).toLocaleString()}`);
  console.log(`    Prepayments:  ${Number(beforePrepay[0].prepay).toLocaleString()}`);
  console.log(`    Net debt:     ${(Number(beforeDebt[0].debt) - Number(beforePrepay[0].prepay)).toLocaleString()}`);
  console.log(`  AFTER fix (from real payments):`);
  console.log(`    Gross debt:   ${Number(afterDebt[0].debt).toLocaleString()}`);
  console.log(`    Prepayments:  ${Number(afterPrepay[0].prepay).toLocaleString()}`);
  console.log(`    Net debt:     ${(Number(afterDebt[0].debt) - Number(afterPrepay[0].prepay)).toLocaleString()}`);
  console.log(`  Excel reference:`);
  console.log(`    Gross debt:   1,221,993,663`);
  console.log(`    Prepayments:  241,058,500`);
  console.log(`    Net debt:     983,502,063`);

  if (!APPLY) {
    console.log('\n\n*** DRY RUN — no changes made. Run with --apply to fix. ***\n');
    return;
  }

  // 5. Apply fixes
  console.log('\n\nApplying fixes...\n');

  let fixed = 0;
  let statusChanged = 0;

  for (const r of mismatches) {
    const realPaid = Number(r.sum_payments);
    const dealAmount = Number(r.amount);

    // Determine correct paymentStatus
    let newStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
    if (realPaid <= 0) {
      newStatus = 'UNPAID';
    } else if (realPaid >= dealAmount) {
      newStatus = 'PAID';
    } else {
      newStatus = 'PARTIAL';
    }

    const oldStatus = r.payment_status;

    await prisma.deal.update({
      where: { id: r.id },
      data: {
        paidAmount: realPaid,
        paymentStatus: newStatus,
      },
    });

    fixed++;
    if (oldStatus !== newStatus) statusChanged++;
  }

  console.log(`  Fixed paidAmount on ${fixed} deals`);
  console.log(`  Changed paymentStatus on ${statusChanged} deals`);

  // 6. Verify
  const verifyDebt = await prisma.$queryRaw<{ debt: string }[]>`
    SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt
    FROM deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND (d.amount - d.paid_amount) > 0
  `;

  const verifyPrepay = await prisma.$queryRaw<{ prepay: string }[]>`
    SELECT COALESCE(SUM(d.paid_amount - d.amount), 0)::text as prepay
    FROM deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND d.paid_amount > d.amount
  `;

  console.log(`\n=== AFTER FIX VERIFICATION ===`);
  console.log(`  Gross debt:   ${Number(verifyDebt[0].debt).toLocaleString()}`);
  console.log(`  Prepayments:  ${Number(verifyPrepay[0].prepay).toLocaleString()}`);
  console.log(`  Net debt:     ${(Number(verifyDebt[0].debt) - Number(verifyPrepay[0].prepay)).toLocaleString()}`);
  console.log(`\n  Done!\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
