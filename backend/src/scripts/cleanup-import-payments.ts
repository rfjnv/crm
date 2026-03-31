/**
 * Cleanup: remove all "Импорт из Excel" payments and recalculate deal.paidAmount
 *
 * Run:
 *   cd backend && npx tsx src/scripts/cleanup-import-payments.ts            # dry-run
 *   cd backend && npx tsx src/scripts/cleanup-import-payments.ts --execute   # live
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(70));
  console.log(`  CLEANUP IMPORT PAYMENTS  ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(70));

  // Find all payments created by import-payments.ts
  const importPayments = await prisma.payment.findMany({
    where: {
      note: { startsWith: 'Импорт из Excel' },
    },
    select: {
      id: true,
      dealId: true,
      clientId: true,
      amount: true,
      paidAt: true,
      note: true,
    },
    orderBy: { paidAt: 'asc' },
  });

  console.log(`\nFound ${importPayments.length} "Импорт из Excel" payments to remove`);

  if (importPayments.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  // Group by client
  const byClient = new Map<string, typeof importPayments>();
  for (const p of importPayments) {
    const arr = byClient.get(p.clientId) || [];
    arr.push(p);
    byClient.set(p.clientId, arr);
  }

  // Get client names
  const clientIds = [...byClient.keys()];
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, companyName: true },
  });
  const clientNames = new Map(clients.map(c => [c.id, c.companyName]));

  let totalAmount = 0;
  console.log(`\nPayments to remove by client:`);
  console.log('-'.repeat(80));

  for (const [clientId, payments] of byClient) {
    const clientTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
    totalAmount += clientTotal;
    console.log(
      `  ${(clientNames.get(clientId) || clientId).padEnd(35)} | ` +
      `${payments.length} payments | ` +
      `${clientTotal.toLocaleString('ru-RU')} sum`
    );
    for (const p of payments) {
      console.log(
        `    ${Number(p.amount).toLocaleString('ru-RU').padStart(16)} | ` +
        `${p.paidAt.toISOString().slice(0, 10)} | ` +
        `${p.note}`
      );
    }
  }

  console.log('-'.repeat(80));
  console.log(`  TOTAL: ${importPayments.length} payments, ${totalAmount.toLocaleString('ru-RU')} sum, ${byClient.size} clients`);

  // Collect affected deal IDs
  const affectedDealIds = [...new Set(importPayments.map(p => p.dealId))];
  console.log(`\n  Affected deals to recalculate: ${affectedDealIds.length}`);

  if (!isExecute) {
    console.log('\n  DRY-RUN complete. Run with --execute to apply.');
    return;
  }

  // Execute cleanup
  console.log('\n  EXECUTING CLEANUP...');

  // Step 1: Delete all import payments
  const deleted = await prisma.payment.deleteMany({
    where: { note: { startsWith: 'Импорт из Excel' } },
  });
  console.log(`    Deleted ${deleted.count} payments`);

  // Step 2: Recalculate paidAmount for affected deals in batches
  const BATCH_SIZE = 50;
  let dealsUpdated = 0;

  for (let i = 0; i < affectedDealIds.length; i += BATCH_SIZE) {
    const batch = affectedDealIds.slice(i, i + BATCH_SIZE);

    await prisma.$transaction(async (tx) => {
      for (const dealId of batch) {
        const result = await tx.payment.aggregate({
          where: { dealId },
          _sum: { amount: true },
        });
        const newPaid = Number(result._sum.amount || 0);

        const deal = await tx.deal.findUnique({
          where: { id: dealId },
          select: { amount: true, paidAmount: true, paymentStatus: true },
        });
        if (!deal) return;

        const dealAmount = Number(deal.amount);
        const newStatus = computePaymentStatus(newPaid, dealAmount);
        const oldPaid = Number(deal.paidAmount);

        if (Math.abs(oldPaid - newPaid) > 0.01 || deal.paymentStatus !== newStatus) {
          await tx.deal.update({
            where: { id: dealId },
            data: {
              paidAmount: newPaid,
              paymentStatus: newStatus as any,
            },
          });
          dealsUpdated++;
        }
      }
    }, { maxWait: 30000, timeout: 60000 });

    console.log(`    Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(affectedDealIds.length / BATCH_SIZE)}: processed ${Math.min(i + BATCH_SIZE, affectedDealIds.length)}/${affectedDealIds.length} deals`);
  }

  console.log(`    Updated ${dealsUpdated} deals`);

  // Verify
  const postCheck = await prisma.$queryRaw<{ gross: string; net: string }[]>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
      FROM deals d
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED', 'REJECTED')
    `
  );

  console.log(`\n  Post-cleanup debt:`);
  console.log(`    Gross: ${Number(postCheck[0].gross).toLocaleString('ru-RU')}`);
  console.log(`    Net:   ${Number(postCheck[0].net).toLocaleString('ru-RU')}`);
  console.log(`\n  CLEANUP COMPLETE`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
