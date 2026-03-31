/**
 * Phase 4: Remove synthetic payments (Сверка/Импорт) and recalculate paidAmount.
 *
 * Run:
 *   cd backend && npx tsx src/scripts/rebuild/phase4-cleanup.ts            # dry-run
 *   cd backend && npx tsx src/scripts/rebuild/phase4-cleanup.ts --apply    # live
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

async function main() {
  console.log(`=== Phase 4: CLEANUP SYNTHETIC PAYMENTS ${APPLY ? '*** APPLY ***' : '(dry-run)'} ===\n`);

  // Find synthetic payments
  const syntheticPayments = await prisma.payment.findMany({
    where: {
      OR: [
        { note: { startsWith: 'Сверка CRM-Excel' } },
        { note: { startsWith: 'Импорт из Excel' } },
      ],
    },
    select: { id: true, dealId: true, amount: true, note: true },
  });

  // Group by note prefix
  const sverkaCount = syntheticPayments.filter(p => p.note?.startsWith('Сверка')).length;
  const importCount = syntheticPayments.filter(p => p.note?.startsWith('Импорт')).length;
  const totalAmount = syntheticPayments.reduce((s, p) => s + Number(p.amount), 0);

  console.log(`Found ${syntheticPayments.length} synthetic payments to remove:`);
  console.log(`  "Сверка CRM-Excel..." payments: ${sverkaCount}`);
  console.log(`  "Импорт из Excel..." payments:  ${importCount}`);
  console.log(`  Total amount:                   ${totalAmount.toLocaleString('ru-RU')}\n`);

  if (syntheticPayments.length === 0) {
    console.log('Nothing to clean up!');
    return;
  }

  // Collect affected deal IDs
  const affectedDealIds = [...new Set(syntheticPayments.map(p => p.dealId))];
  console.log(`  Affected deals to recalculate: ${affectedDealIds.length}`);

  if (!APPLY) {
    // Show current vs projected debt
    const currentDebt = await prisma.$queryRaw<{ gross: string; net: string }[]>(Prisma.sql`
      SELECT COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
      FROM deals d WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
    `);
    console.log(`\n  Current gross debt: ${Number(currentDebt[0].gross).toLocaleString('ru-RU')}`);
    console.log(`  Current net debt:   ${Number(currentDebt[0].net).toLocaleString('ru-RU')}`);
    console.log('\n*** DRY RUN — run with --apply to execute ***');
    return;
  }

  // Execute
  console.log('\n  Deleting synthetic payments...');
  const deleted = await prisma.payment.deleteMany({
    where: {
      OR: [
        { note: { startsWith: 'Сверка CRM-Excel' } },
        { note: { startsWith: 'Импорт из Excel' } },
      ],
    },
  });
  console.log(`  Deleted ${deleted.count} payments`);

  // Recalculate paidAmount for affected deals
  console.log('  Recalculating paidAmount...');
  const BATCH = 50;
  let updated = 0;

  for (let i = 0; i < affectedDealIds.length; i += BATCH) {
    const batch = affectedDealIds.slice(i, i + BATCH);

    await prisma.$transaction(async (tx) => {
      for (const dealId of batch) {
        const paySum = await tx.payment.aggregate({
          where: { dealId },
          _sum: { amount: true },
        });
        const newPaid = Number(paySum._sum.amount || 0);

        const deal = await tx.deal.findUnique({
          where: { id: dealId },
          select: { amount: true },
        });
        if (!deal) return;

        const newStatus = computePaymentStatus(newPaid, Number(deal.amount));

        await tx.deal.update({
          where: { id: dealId },
          data: { paidAmount: newPaid, paymentStatus: newStatus as any },
        });
        updated++;
      }
    }, { maxWait: 30000, timeout: 60000 });

    if ((i + BATCH) % 200 === 0) {
      console.log(`    Progress: ${Math.min(i + BATCH, affectedDealIds.length)}/${affectedDealIds.length}`);
    }
  }

  console.log(`  Updated ${updated} deals`);

  // Verify
  const postDebt = await prisma.$queryRaw<{ gross: string; net: string }[]>(Prisma.sql`
    SELECT COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
      COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
    FROM deals d WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
  `);

  console.log(`\n  Post-cleanup gross debt: ${Number(postDebt[0].gross).toLocaleString('ru-RU')}`);
  console.log(`  Post-cleanup net debt:   ${Number(postDebt[0].net).toLocaleString('ru-RU')}`);
  console.log('\nDone!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
