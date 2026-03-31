/**
 * Delete March 2026 imported deals and related data,
 * then re-import from the updated analytics file.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all March 2026 deals
  const marchDeals = await prisma.deal.findMany({
    where: { title: { contains: 'Март 2026' }, status: 'CLOSED' },
    select: { id: true, title: true },
  });

  console.log(`Found ${marchDeals.length} March 2026 deals to delete`);

  if (marchDeals.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const dealIds = marchDeals.map(d => d.id);

  // Delete in correct order (foreign key dependencies)
  console.log('Deleting payments...');
  const payments = await prisma.payment.deleteMany({
    where: { dealId: { in: dealIds } },
  });
  console.log(`  Deleted ${payments.count} payments`);

  console.log('Deleting inventory movements...');
  const movements = await prisma.inventoryMovement.deleteMany({
    where: { dealId: { in: dealIds } },
  });
  console.log(`  Deleted ${movements.count} inventory movements`);

  console.log('Deleting deal items...');
  const items = await prisma.dealItem.deleteMany({
    where: { dealId: { in: dealIds } },
  });
  console.log(`  Deleted ${items.count} deal items`);

  console.log('Deleting deals...');
  const deals = await prisma.deal.deleteMany({
    where: { id: { in: dealIds } },
  });
  console.log(`  Deleted ${deals.count} deals`);

  console.log('\nDone! March 2026 data cleared.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
