/**
 * Fix payments with erroneous dates (1899-12-31 and other pre-2020 dates).
 *
 * These dates come from Excel serial number 0 being parsed as Dec 31, 1899.
 * The fix sets paid_at = deal.created_at (middle of the month from import).
 *
 * Run:
 *   cd backend && npx tsx src/scripts/fix-payment-dates.ts            # dry-run
 *   cd backend && npx tsx src/scripts/fix-payment-dates.ts --execute   # live
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(60));
  console.log(`  FIX PAYMENT DATES ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(60));

  // Find all payments with dates before 2020
  const badPayments = await prisma.$queryRaw<
    {
      id: string;
      paid_at: Date;
      amount: string;
      deal_id: string;
      deal_title: string;
      deal_created: Date;
      company_name: string;
      method: string;
    }[]
  >(
    Prisma.sql`
      SELECT p.id, p.paid_at, p.amount::text, p.deal_id,
        d.title as deal_title, d.created_at as deal_created,
        c.company_name, p.method
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      JOIN clients c ON c.id = p.client_id
      WHERE p.paid_at < '2020-01-01'
      ORDER BY p.paid_at
    `
  );

  console.log(`\nFound ${badPayments.length} payments with dates before 2020\n`);

  if (badPayments.length === 0) {
    console.log('Nothing to fix.');
    return;
  }

  // Show all affected payments
  console.log('Client'.padEnd(30) + ' | ' + 'Bad Date'.padEnd(12) + ' | ' +
    'New Date'.padEnd(12) + ' | ' + 'Amount'.padStart(14) + ' | Method');
  console.log('-'.repeat(90));

  for (const p of badPayments) {
    const newDate = p.deal_created;
    console.log(
      p.company_name.substring(0, 30).padEnd(30) + ' | ' +
      p.paid_at.toISOString().slice(0, 10).padEnd(12) + ' | ' +
      newDate.toISOString().slice(0, 10).padEnd(12) + ' | ' +
      Number(p.amount).toLocaleString().padStart(14) + ' | ' +
      (p.method || 'N/A')
    );
  }

  if (isExecute) {
    console.log(`\nFixing ${badPayments.length} payments...`);
    let fixed = 0;
    let errors = 0;

    for (const p of badPayments) {
      try {
        await prisma.payment.update({
          where: { id: p.id },
          data: {
            paidAt: p.deal_created,
            createdAt: p.deal_created,
          },
        });
        fixed++;
      } catch (err) {
        errors++;
        console.error(`  ERROR: ${p.id}: ${(err as Error).message.slice(0, 100)}`);
      }
    }

    console.log(`\nDone: ${fixed} fixed, ${errors} errors`);
  } else {
    console.log('\nThis was a DRY-RUN. To execute, run with --execute flag.');
  }
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
