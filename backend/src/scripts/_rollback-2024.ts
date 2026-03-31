/**
 * Rollback the bad 2024 import.
 * Deletes "Импорт 2024:" payments and "— Импорт 2024" summary deals.
 * Then recalculates affected deal paidAmounts.
 *
 * cd backend && npx tsx src/scripts/_rollback-2024.ts            # dry
 * cd backend && npx tsx src/scripts/_rollback-2024.ts --execute   # live
 */

import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ROLLBACK 2024 IMPORT  ${EXECUTE ? '** LIVE **' : '(DRY RUN)'}`);
  console.log(`${'='.repeat(60)}\n`);

  // 1. Count "Импорт 2024" payments
  const importPayments = await prisma.payment.findMany({
    where: { note: { startsWith: 'Импорт 2024:' } },
    select: { id: true, dealId: true, amount: true, clientId: true },
  });
  const importTotal = importPayments.reduce((s, p) => s + Number(p.amount), 0);
  console.log(`"Импорт 2024:" payments: ${importPayments.length} (${importTotal.toLocaleString()} UZS)`);

  // 2. Count "— Импорт 2024" deals
  const importDeals = await prisma.deal.findMany({
    where: { title: { contains: '— Импорт 2024' } },
    select: { id: true, title: true, amount: true },
  });
  console.log(`"— Импорт 2024" deals: ${importDeals.length}`);

  // 3. Find affected deals (deals that received Импорт 2024 payments)
  const affectedDealIds = new Set<string>();
  for (const p of importPayments) affectedDealIds.add(p.dealId);
  console.log(`Affected deals (received payments): ${affectedDealIds.size}`);

  if (EXECUTE) {
    // Delete import payments
    console.log('\nDeleting import payments...');
    const delPayments = await prisma.payment.deleteMany({
      where: { note: { startsWith: 'Импорт 2024:' } },
    });
    console.log(`  Deleted: ${delPayments.count} payments`);

    // Delete import deals (with their items)
    console.log('Deleting import deals...');
    // First delete deal_items for these deals
    for (const d of importDeals) {
      await prisma.dealItem.deleteMany({ where: { dealId: d.id } });
    }
    const delDeals = await prisma.deal.deleteMany({
      where: { title: { contains: '— Импорт 2024' } },
    });
    console.log(`  Deleted: ${delDeals.count} deals`);

    // Recalculate paidAmount for affected deals
    console.log('Recalculating deal paidAmounts...');
    let recalculated = 0;
    for (const dealId of affectedDealIds) {
      // Skip deleted deals
      const exists = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
      if (!exists) continue;

      const payments = await prisma.payment.findMany({
        where: { dealId },
        select: { amount: true },
      });
      const newPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
      const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { amount: true } });
      const amount = Number(deal!.amount);
      const newStatus = newPaid >= amount ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'UNPAID');

      await prisma.deal.update({
        where: { id: dealId },
        data: { paidAmount: newPaid, paymentStatus: newStatus as any },
      });
      recalculated++;
    }
    console.log(`  Recalculated: ${recalculated} deals`);

    // Verify
    const afterPayments = await prisma.$queryRaw<{ cnt: string, total: string }[]>(
      Prisma.sql`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM payments WHERE paid_at >= '2024-01-01' AND paid_at < '2025-01-01'`
    );
    const afterDeals = await prisma.$queryRaw<{ cnt: string }[]>(
      Prisma.sql`SELECT COUNT(*)::text as cnt FROM deals WHERE title LIKE '%Импорт 2024%'`
    );
    console.log(`\nAfter rollback:`);
    console.log(`  2024 payments: ${afterPayments[0].cnt} (${Number(afterPayments[0].total).toLocaleString()} UZS)`);
    console.log(`  Import 2024 deals: ${afterDeals[0].cnt}`);
  } else {
    console.log('\n  DRY RUN — use --execute to apply');
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
