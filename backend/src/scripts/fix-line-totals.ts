/**
 * One-time fix: sync lineTotal for all deal_items where lineTotal is NULL
 * but requested_qty and price are set.
 * 
 * This fixes revenue calculations for deals that were created/updated
 * via override (which didn't set lineTotal).
 * 
 * Run: npx tsx src/scripts/fix-line-totals.ts
 */
import prisma from '../lib/prisma';

async function main() {
  console.log('=== FIX: Sync lineTotal for deal_items ===\n');

  // Find items where lineTotal is wrong or NULL
  const items = await prisma.dealItem.findMany({
    where: {
      requestedQty: { not: null },
      price: { not: null },
    },
    select: {
      id: true,
      requestedQty: true,
      price: true,
      lineTotal: true,
      deal: {
        select: { id: true, title: true, status: true },
      },
    },
  });

  let fixedNull = 0;
  let fixedMismatch = 0;
  let alreadyCorrect = 0;

  for (const item of items) {
    const qty = Number(item.requestedQty);
    const price = Number(item.price);
    const expectedLineTotal = qty > 0 && price > 0 ? qty * price : null;
    const currentLineTotal = item.lineTotal != null ? Number(item.lineTotal) : null;

    if (expectedLineTotal === null) {
      // Can't compute — skip
      continue;
    }

    if (currentLineTotal === null) {
      // lineTotal is NULL but should have a value
      await prisma.dealItem.update({
        where: { id: item.id },
        data: { lineTotal: expectedLineTotal },
      });
      fixedNull++;
      console.log(`  [NULL→${expectedLineTotal.toLocaleString('ru-RU')}] deal="${item.deal.title}" (${item.deal.id.slice(0, 8)})`);
    } else if (Math.abs(currentLineTotal - expectedLineTotal) > 0.01) {
      // lineTotal doesn't match qty*price
      await prisma.dealItem.update({
        where: { id: item.id },
        data: { lineTotal: expectedLineTotal },
      });
      fixedMismatch++;
      console.log(`  [${currentLineTotal.toLocaleString('ru-RU')}→${expectedLineTotal.toLocaleString('ru-RU')}] deal="${item.deal.title}" (${item.deal.id.slice(0, 8)})`);
    } else {
      alreadyCorrect++;
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Total items checked: ${items.length}`);
  console.log(`Fixed NULL lineTotal: ${fixedNull}`);
  console.log(`Fixed mismatched lineTotal: ${fixedMismatch}`);
  console.log(`Already correct: ${alreadyCorrect}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
