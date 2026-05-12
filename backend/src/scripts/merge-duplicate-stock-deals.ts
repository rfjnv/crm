/**
 * Объединяет дубликаты «Списание остатков склада клиента (ппс) от …»
 * у клиента ппс по ключу (title, дата closedAt YYYY-MM-DD).
 *
 * В каждой группе:
 *   • primary = первый по createdAt;
 *   • переносятся: DealItem, DealComment, Payment, InventoryMovement, Message,
 *                  ClientStockEvent.sourceDealId, Shipment (move dealId), DealRating;
 *   • primary.amount     = Σ amount по группе;
 *   • primary.paidAmount = Σ paidAmount по группе;
 *   • secondary deals удаляются.
 *
 * Все DealItem ОСТАЮТСЯ отдельными строками (sourceOpType/dealDate сохраняются).
 *
 * Запуск:
 *   cd backend
 *   npx tsx src/scripts/merge-duplicate-stock-deals.ts            # preview
 *   npx tsx src/scripts/merge-duplicate-stock-deals.ts --execute  # применить
 */
import prisma from '../lib/prisma';
import type { Prisma } from '@prisma/client';

const PPS_ID = '5956dca1-8db3-424a-a61a-e42cb97c09fe';
const TITLE_PREFIX = 'Списание остатков склада клиента (ппс) от ';

function ymd(d: Date | null): string {
  if (!d) return '0000-00-00';
  return d.toISOString().slice(0, 10);
}

async function main() {
  const isExecute = process.argv.includes('--execute');
  console.log('='.repeat(80));
  console.log(`  MERGE DUP STOCK-DEALS  ${isExecute ? '** LIVE **' : '(PREVIEW)'}`);
  console.log('='.repeat(80));

  const deals = await prisma.deal.findMany({
    where: {
      clientId: PPS_ID,
      title: { startsWith: TITLE_PREFIX },
    },
    select: {
      id: true,
      title: true,
      amount: true,
      paidAmount: true,
      discount: true,
      createdAt: true,
      closedAt: true,
      _count: { select: { items: true, payments: true, comments: true, movements: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\nMatched stock-deals: ${deals.length}`);

  type Group = {
    key: string;
    primary: typeof deals[number];
    secondaries: typeof deals;
  };
  const groupMap = new Map<string, typeof deals>();
  for (const d of deals) {
    const key = `${d.title}\u0000${ymd(d.closedAt)}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(d);
  }
  const groups: Group[] = [];
  for (const [key, arr] of groupMap) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    groups.push({ key, primary: sorted[0], secondaries: sorted.slice(1) });
  }
  console.log(`Groups with duplicates: ${groups.length}`);
  console.log(`Secondary deals to merge away: ${groups.reduce((s, g) => s + g.secondaries.length, 0)}`);

  if (groups.length === 0) {
    console.log('\nNo duplicates. Nothing to do.');
    return;
  }

  console.log(`\n--- TOP groups (by secondaries count) ---`);
  for (const g of [...groups].sort((a, b) => b.secondaries.length - a.secondaries.length).slice(0, 8)) {
    const sumAmount = [g.primary, ...g.secondaries].reduce((s, d) => s + Number(d.amount), 0);
    console.log(
      `  ${g.secondaries.length + 1}x  ${ymd(g.primary.closedAt)}  "${g.primary.title.slice(0, 60)}"  Σamount=${sumAmount.toLocaleString('ru-RU')}`,
    );
  }

  if (!isExecute) {
    console.log('\nPREVIEW done. Run with --execute to apply.');
    return;
  }

  console.log('\n  EXECUTING…');
  const startedAt = Date.now();
  const stat = {
    groupsProcessed: 0,
    secondariesDeleted: 0,
    movedItems: 0,
    movedPayments: 0,
    movedComments: 0,
    movedMovements: 0,
    movedMessages: 0,
    movedStockEvents: 0,
    movedShipments: 0,
    movedRatings: 0,
    primaryAmountUpdates: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      for (const g of groups) {
        const primaryId = g.primary.id;
        const secIds = g.secondaries.map((s) => s.id);

        // Move all child references away from secondaries onto primary
        const r1 = await tx.dealItem.updateMany({
          where: { dealId: { in: secIds } },
          data: { dealId: primaryId },
        });
        stat.movedItems += r1.count;

        const r2 = await tx.payment.updateMany({
          where: { dealId: { in: secIds } },
          data: { dealId: primaryId },
        });
        stat.movedPayments += r2.count;

        const r3 = await tx.dealComment.updateMany({
          where: { dealId: { in: secIds } },
          data: { dealId: primaryId },
        });
        stat.movedComments += r3.count;

        const r4 = await tx.inventoryMovement.updateMany({
          where: { dealId: { in: secIds } },
          data: { dealId: primaryId },
        });
        stat.movedMovements += r4.count;

        const r5 = await tx.message.updateMany({
          where: { dealId: { in: secIds } },
          data: { dealId: primaryId },
        });
        stat.movedMessages += r5.count;

        const r6 = await tx.clientStockEvent.updateMany({
          where: { sourceDealId: { in: secIds } },
          data: { sourceDealId: primaryId },
        });
        stat.movedStockEvents += r6.count;

        // Shipment is 1:1 with Deal (unique dealId). Primary may already have one; if so, secondary's
        // shipment must be deleted to avoid unique-constraint violation. For our stock-deals there are none.
        const primaryShipment = await tx.shipment.findUnique({ where: { dealId: primaryId }, select: { id: true } });
        const secShipments = await tx.shipment.findMany({ where: { dealId: { in: secIds } }, select: { id: true, dealId: true } });
        for (const sh of secShipments) {
          if (primaryShipment) {
            // Conflict: primary already has shipment — delete secondary's
            await tx.shipment.delete({ where: { id: sh.id } });
          } else {
            await tx.shipment.update({ where: { id: sh.id }, data: { dealId: primaryId } });
            stat.movedShipments++;
          }
        }

        // DealRating same constraint
        const primaryRating = await tx.dealRating.findUnique({ where: { dealId: primaryId }, select: { id: true } });
        const secRatings = await tx.dealRating.findMany({ where: { dealId: { in: secIds } }, select: { id: true } });
        for (const rt of secRatings) {
          if (primaryRating) {
            await tx.dealRating.delete({ where: { id: rt.id } });
          } else {
            await tx.dealRating.update({ where: { id: rt.id }, data: { dealId: primaryId } });
            stat.movedRatings++;
          }
        }

        // Sum amount and paidAmount: primary.amount = Σ all in group
        const sumAmount = [g.primary, ...g.secondaries].reduce((s, d) => s + Number(d.amount), 0);
        const sumPaid = [g.primary, ...g.secondaries].reduce((s, d) => s + Number(d.paidAmount), 0);
        await tx.deal.update({
          where: { id: primaryId },
          data: { amount: sumAmount, paidAmount: sumPaid },
        });
        stat.primaryAmountUpdates++;

        // Delete secondary deals (no children left referencing them)
        const del = await tx.deal.deleteMany({ where: { id: { in: secIds } } });
        stat.secondariesDeleted += del.count;
        stat.groupsProcessed++;
      }
    },
    { timeout: 10 * 60 * 1000, maxWait: 30 * 1000, isolationLevel: 'ReadCommitted' as Prisma.TransactionIsolationLevel },
  );

  const ms = Date.now() - startedAt;
  console.log('\n' + '='.repeat(80));
  console.log(`  DONE in ${(ms / 1000).toFixed(1)}s`);
  console.log('='.repeat(80));
  console.log(`  groups processed:         ${stat.groupsProcessed}`);
  console.log(`  secondary deals deleted:  ${stat.secondariesDeleted}`);
  console.log(`  moved deal_items:         ${stat.movedItems}`);
  console.log(`  moved payments:           ${stat.movedPayments}`);
  console.log(`  moved deal_comments:      ${stat.movedComments}`);
  console.log(`  moved inventory_moves:    ${stat.movedMovements}`);
  console.log(`  moved messages:           ${stat.movedMessages}`);
  console.log(`  moved stock_events.src:   ${stat.movedStockEvents}`);
  console.log(`  moved shipments:          ${stat.movedShipments}`);
  console.log(`  moved deal_ratings:       ${stat.movedRatings}`);
  console.log(`  primary amount updates:   ${stat.primaryAmountUpdates}`);

  // Post-check
  const totalAfter = await prisma.deal.count({ where: { clientId: PPS_ID } });
  const stockAfter = await prisma.deal.count({
    where: { clientId: PPS_ID, title: { startsWith: TITLE_PREFIX } },
  });
  const sumAmountAfter = await prisma.deal.aggregate({
    where: { clientId: PPS_ID, title: { startsWith: TITLE_PREFIX } },
    _sum: { amount: true },
  });
  console.log(`\n--- POST-CHECK ---`);
  console.log(`  ппс total deals: ${totalAfter}`);
  console.log(`  stock-deals on ппс: ${stockAfter}`);
  console.log(`  Σ amount of stock-deals: ${Number(sumAmountAfter._sum.amount || 0).toLocaleString('ru-RU')}`);
}

main()
  .catch((e) => {
    console.error('\nFAILED:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
