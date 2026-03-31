/**
 * Phase 2: Deduplicate deals — merge children, archive duplicates, recalculate amounts.
 *
 * Run:
 *   cd backend && npx tsx src/scripts/rebuild/phase2-dedup.ts            # dry-run
 *   cd backend && npx tsx src/scripts/rebuild/phase2-dedup.ts --apply    # live
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
  console.log(`=== Phase 2: DEDUPLICATE DEALS ${APPLY ? '*** APPLY ***' : '(dry-run)'} ===\n`);

  // Find all duplicate groups
  const groups = await prisma.$queryRaw<{ client_id: string; title: string; cnt: string }[]>(Prisma.sql`
    SELECT client_id, title, COUNT(*)::text as cnt
    FROM deals
    WHERE is_archived = false AND status NOT IN ('CANCELED', 'REJECTED')
    GROUP BY client_id, title
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);

  console.log(`Found ${groups.length} duplicate groups\n`);

  let totalArchived = 0;
  let totalChildrenMoved = 0;

  for (const group of groups) {
    // Get all deals in this group, ordered by item count desc (most items = keeper)
    const deals = await prisma.deal.findMany({
      where: {
        clientId: group.client_id,
        title: group.title,
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
      },
      include: {
        _count: { select: { items: true, payments: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (deals.length <= 1) continue;

    // Pick keeper: the one with most items, or if tied — earliest created
    const sorted = [...deals].sort((a, b) => {
      const diff = b._count.items - a._count.items;
      if (diff !== 0) return diff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keeper = sorted[0];
    const dupes = sorted.slice(1);

    if (APPLY) {
      for (const dupe of dupes) {
        // Move DealItems to keeper
        const movedItems = await prisma.dealItem.updateMany({
          where: { dealId: dupe.id },
          data: { dealId: keeper.id },
        });

        // Move Payments to keeper
        const movedPayments = await prisma.payment.updateMany({
          where: { dealId: dupe.id },
          data: { dealId: keeper.id },
        });

        // Move DealComments to keeper
        const movedComments = await prisma.dealComment.updateMany({
          where: { dealId: dupe.id },
          data: { dealId: keeper.id },
        });

        // Move InventoryMovements to keeper
        const movedMovements = await prisma.inventoryMovement.updateMany({
          where: { dealId: dupe.id },
          data: { dealId: keeper.id },
        });

        // Move Messages to keeper
        const movedMessages = await prisma.message.updateMany({
          where: { dealId: dupe.id },
          data: { dealId: keeper.id },
        });

        // Move Shipment if exists (unique per deal, so only if keeper doesn't have one)
        const keeperShipment = await prisma.shipment.findUnique({ where: { dealId: keeper.id } });
        if (!keeperShipment) {
          await prisma.shipment.updateMany({
            where: { dealId: dupe.id },
            data: { dealId: keeper.id },
          });
        } else {
          // Delete duplicate shipment if keeper already has one
          await prisma.shipment.deleteMany({ where: { dealId: dupe.id } });
        }

        totalChildrenMoved += movedItems.count + movedPayments.count +
          movedComments.count + movedMovements.count + movedMessages.count;

        // Archive duplicate
        await prisma.deal.update({
          where: { id: dupe.id },
          data: { isArchived: true, status: 'CANCELED' },
        });
        totalArchived++;
      }

      // Recalculate keeper's paidAmount from payments
      const paymentSum = await prisma.payment.aggregate({
        where: { dealId: keeper.id },
        _sum: { amount: true },
      });
      const newPaid = Number(paymentSum._sum.amount || 0);

      // Recalculate keeper's amount from deal items via SQL (no totalPrice field)
      const itemSumResult = await prisma.$queryRawUnsafe<{ total: string }[]>(
        `SELECT COALESCE(SUM(COALESCE(requested_qty, 0) * COALESCE(price, 0)), 0)::text as total FROM deal_items WHERE deal_id = $1`,
        keeper.id,
      );
      const newAmount = Number(itemSumResult[0]?.total || 0);

      const newStatus = computePaymentStatus(newPaid, newAmount > 0 ? newAmount : Number(keeper.amount));

      await prisma.deal.update({
        where: { id: keeper.id },
        data: {
          paidAmount: newPaid,
          amount: newAmount > 0 ? newAmount : undefined,
          paymentStatus: newStatus as any,
        },
      });
    } else {
      totalArchived += dupes.length;
    }

    if (totalArchived % 100 === 0 && totalArchived > 0) {
      console.log(`  Progress: ${totalArchived} deals archived...`);
    }
  }

  // Print results
  const result = await prisma.$queryRaw<{ cnt: string; total_amount: string; total_paid: string }[]>(Prisma.sql`
    SELECT COUNT(*)::text as cnt,
      COALESCE(SUM(amount), 0)::text as total_amount,
      COALESCE(SUM(paid_amount), 0)::text as total_paid
    FROM deals WHERE is_archived = false AND status NOT IN ('CANCELED', 'REJECTED')
  `);

  console.log('\n' + '='.repeat(70));
  console.log('RESULT');
  console.log('='.repeat(70));
  console.log(`  Duplicate deals archived:    ${totalArchived}`);
  console.log(`  Children records moved:      ${totalChildrenMoved}`);
  console.log(`  Active deals remaining:      ${result[0].cnt}`);
  console.log(`  SUM(amount):                 ${Number(result[0].total_amount).toLocaleString('ru-RU')}`);
  console.log(`  SUM(paid_amount):            ${Number(result[0].total_paid).toLocaleString('ru-RU')}`);
  console.log(`  Net debt:                    ${(Number(result[0].total_amount) - Number(result[0].total_paid)).toLocaleString('ru-RU')}`);

  if (!APPLY) console.log('\n*** DRY RUN — run with --apply to execute ***');
}

main().catch(console.error).finally(() => prisma.$disconnect());
