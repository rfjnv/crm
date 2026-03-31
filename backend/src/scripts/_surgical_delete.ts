import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔥 SURGICAL DELETE - DROP AND RECREATE FK...\n');

    // Step 1: Delete all child records
    console.log('Step 1: Deleting all child records...');
    await prisma.$executeRawUnsafe('DELETE FROM inventory_movements');
    await prisma.$executeRawUnsafe('DELETE FROM deal_comments');
    await prisma.$executeRawUnsafe('DELETE FROM deal_items');
    await prisma.$executeRawUnsafe('DELETE FROM payments');
    await prisma.$executeRawUnsafe('DELETE FROM shipments');
    await prisma.$executeRawUnsafe('DELETE FROM messages');
    console.log('✅ Child records deleted');

    // Step 2: Check if there are still deals
    const dealCount = await prisma.deal.count();
    console.log(`\nStep 2: Checking deals... Found: ${dealCount}`);

    if (dealCount > 0) {
      console.log('🔨 Forcefully deleting deals with raw SQL...');
      const result = await prisma.$executeRawUnsafe(`
        WITH deleted_deals AS (
          DELETE FROM deals RETURNING id
        )
        SELECT COUNT(*) as count FROM deleted_deals
      `);
      console.log('✅ Deals deleted:', result);
    }

    // Step 3: Now delete contracts and clients
    console.log('\nStep 3: Deleting contracts and clients...');
    await prisma.$executeRawUnsafe('DELETE FROM contracts');
    console.log('✅ contracts deleted');

    await prisma.$executeRawUnsafe('DELETE FROM clients');
    console.log('✅ clients deleted');

    await prisma.$executeRawUnsafe('DELETE FROM products');
    console.log('✅ products deleted');

    console.log('\n✨ Database completely clean!');

    const counts = {
      deals: await prisma.deal.count(),
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
    };

    console.log('\n📊 Final count:');
    Object.entries(counts).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });

    await prisma.$disconnect();
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
