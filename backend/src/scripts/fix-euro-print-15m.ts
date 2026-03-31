/**
 * Fix Евро Принт 15M payment: split into 3 payments with correct dates.
 *
 * Current: 1 payment of 15,000,000 on 2026-03-11
 * Target:
 *   - 1,141,500  on 2026-02-16
 *   - 11,777,400 on 2026-03-04
 *   - 2,081,100  on 2026-03-10
 *
 * Run:
 *   cd backend && npx tsx src/scripts/fix-euro-print-15m.ts            # dry-run
 *   cd backend && npx tsx src/scripts/fix-euro-print-15m.ts --execute   # live
 */

import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

const DEAL_ID = 'deb358bc-1bcc-4b43-8ab4-f466ffdb7aea';

const NEW_PAYMENTS = [
  { amount: 1_141_500,  paidAt: new Date('2026-02-16T05:00:00.000Z') },  // Feb 16, 10:00 Tashkent
  { amount: 11_777_400, paidAt: new Date('2026-03-04T05:00:00.000Z') },  // Mar 4
  { amount: 2_081_100,  paidAt: new Date('2026-03-10T05:00:00.000Z') },  // Mar 10
];

async function main() {
  const isExecute = process.argv.includes('--execute');
  console.log(`=== FIX ЕВРО ПРИНТ 15M  ${isExecute ? '** LIVE **' : '(DRY-RUN)'} ===\n`);

  // Find the 15M payment
  const payment15m = await prisma.payment.findFirst({
    where: {
      dealId: DEAL_ID,
      amount: 15_000_000,
      note: null,
    },
    include: {
      client: { select: { id: true, companyName: true } },
      deal: { select: { id: true, title: true, amount: true, paidAmount: true, paymentStatus: true } },
    },
  });

  if (!payment15m) {
    console.error('ERROR: 15M payment not found on deal', DEAL_ID);
    process.exit(1);
  }

  console.log('Found payment to split:');
  console.log(`  ID:       ${payment15m.id}`);
  console.log(`  Amount:   ${Number(payment15m.amount).toLocaleString()}`);
  console.log(`  Paid at:  ${payment15m.paidAt.toISOString()}`);
  console.log(`  Client:   ${payment15m.client.companyName} (${payment15m.clientId})`);
  console.log(`  Deal:     ${payment15m.deal.title} (${payment15m.dealId})`);
  console.log(`  Deal amt:  ${Number(payment15m.deal.amount).toLocaleString()}`);
  console.log(`  Deal paid: ${Number(payment15m.deal.paidAmount).toLocaleString()}`);

  const totalNew = NEW_PAYMENTS.reduce((s, p) => s + p.amount, 0);
  console.log(`\nNew payments (total=${totalNew.toLocaleString()}):`);
  for (const np of NEW_PAYMENTS) {
    console.log(`  ${np.paidAt.toISOString().slice(0, 10)}  ${np.amount.toLocaleString()}`);
  }

  if (totalNew !== 15_000_000) {
    console.error(`ERROR: New payments total ${totalNew} != 15,000,000`);
    process.exit(1);
  }

  if (!isExecute) {
    console.log('\nDRY-RUN — no changes made. Run with --execute to apply.');
    return;
  }

  // Execute in a transaction
  await prisma.$transaction(async (tx) => {
    // 1. Delete the old 15M payment
    await tx.payment.delete({ where: { id: payment15m.id } });
    console.log(`\nDeleted payment ${payment15m.id}`);

    // 2. Create 3 new payments
    for (const np of NEW_PAYMENTS) {
      const created = await tx.payment.create({
        data: {
          dealId: DEAL_ID,
          clientId: payment15m.clientId,
          amount: np.amount,
          method: payment15m.method || 'TRANSFER',
          paidAt: np.paidAt,
          createdBy: payment15m.createdBy,
          note: null,
          createdAt: np.paidAt,
        },
      });
      console.log(`  Created: ${np.paidAt.toISOString().slice(0, 10)}  ${np.amount.toLocaleString()}  id=${created.id}`);
    }

    // 3. Deal paidAmount stays the same (15M replaced by 15M)
    //    No deal update needed.
  });

  // Verify
  const deal = await prisma.deal.findUnique({
    where: { id: DEAL_ID },
    select: { title: true, amount: true, paidAmount: true, paymentStatus: true },
  });
  const payments = await prisma.payment.findMany({
    where: { dealId: DEAL_ID },
    orderBy: { paidAt: 'desc' },
    select: { id: true, amount: true, paidAt: true, note: true },
  });

  console.log(`\nVerification — Deal: ${deal?.title}`);
  console.log(`  Amount: ${Number(deal?.amount).toLocaleString()}, Paid: ${Number(deal?.paidAmount).toLocaleString()}`);
  console.log(`  Payments on this deal:`);
  for (const p of payments) {
    console.log(`    ${p.paidAt.toISOString().slice(0, 10)}  ${Number(p.amount).toLocaleString().padStart(15)}  ${p.note || ''}`);
  }

  console.log('\nDone!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
