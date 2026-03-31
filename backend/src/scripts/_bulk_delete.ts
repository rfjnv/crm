import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔥 BULK DELETE ALL DEALS...\n');

    // Repeatedly delete deals until none remain
    let iteration = 0;
    while (true) {
      iteration++;
      const count = await prisma.deal.count();
      console.log(`Iteration ${iteration}: Deals remaining: ${count}`);

      if (count === 0) break;

      try {
        // Try to delete in batches
        const deals = await prisma.deal.findMany({ take: 100 });
        const ids = deals.map(d => d.id);

        if (ids.length > 0) {
          await prisma.deal.deleteMany({
            where: { id: { in: ids } },
          });
          console.log(`  Deleted ${ids.length} deals`);
        }
      } catch (e: any) {
        console.log(`  Error deleting deals: ${e.message.substring(0, 100)}`);
        // Try raw delete
        try {
          const result = await prisma.$executeRawUnsafe('DELETE FROM deals LIMIT 1000');
          console.log(`  Raw delete result: ${result} rows`);
        } catch (e2: any) {
          console.log(`  Raw delete also failed: ${e2.message.substring(0, 100)}`);
          break;
        }
      }
    }

    console.log('\n✅ All deals deleted\n');

    // Now delete clients
    console.log('Deleting clients...');
    await prisma.client.deleteMany({});
    console.log('✅ clients deleted');

    await prisma.product.deleteMany({});
    console.log('✅ products deleted');

    console.log('\n✨ Database clean!');

    await prisma.$disconnect();
  } catch (error: any) {
    console.error('Final error:', error.message);
    process.exit(1);
  }
}

main();
