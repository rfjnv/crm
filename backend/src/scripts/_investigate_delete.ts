import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    // Get all remaining deals and try to delete them one by one
    const deals = await prisma.deal.findMany({ take: 50 });
    console.log(`Found ${deals.length} deals to investigate\n`);

    let successCount = 0;
    let failCount = 0;

    for (const deal of deals) {
      try {
        // Try deleting deal_items first
        await prisma.dealItem.deleteMany({ where: { dealId: deal.id } });
        // Then delete the deal
        await prisma.deal.delete({ where: { id: deal.id } });
        successCount++;
      } catch (e: any) {
        failCount++;
        if (failCount <= 3) {
          console.log(`❌ Could not delete deal ${deal.id}: ${e.message.substring(0, 100)}`);
        }
      }
    }

    console.log(`\n✅ Deleted: ${successCount} | ❌ Failed: ${failCount}`);

    // Now try to delete all clients
    console.log('\nDeleting all clients...');
    await prisma.client.deleteMany({});
    console.log(' ✅ clients deleted');

    // Delete products
    console.log('Deleting all products...');
    await prisma.product.deleteMany({});
    console.log('✅ products deleted');

    // Final check
    const finalCounts = {
      deals: await prisma.deal.count(),
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
    };

    console.log('\n📊 Final state:');
    Object.entries(finalCounts).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });

    await prisma.$disconnect();
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
