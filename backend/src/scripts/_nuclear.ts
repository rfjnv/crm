import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔨 FINAL NUCLEAR OPTION - RAW SQL WITH CASCADE...\n');

    // Use raw SQL with ON DELETE CASCADE effectively by deleting in the right order
    console.log('Step 1: Deleting all deal_items (cascade will handle)...');
    const delItems = await prisma.$executeRawUnsafe('DELETE FROM deal_items');
    console.log(`✅ Deleted ${delItems} deal_items`);

    console.log('\nStep 2: Deleting all deals...');
    const delDeals = await prisma.$executeRawUnsafe('DELETE FROM deals');
    console.log(`✅ Deleted ${delDeals} deals`);

    console.log('\nStep 3: Deleting remaining foreign keys...');
    await prisma.$executeRawUnsafe('DELETE FROM contracts');
    console.log('✅ contracts deleted');

    await prisma.$executeRawUnsafe('DELETE FROM payments');
    console.log('✅ payments deleted');

    await prisma.$executeRawUnsafe('DELETE FROM inventory_movements');
    console.log('✅ inventory_movements deleted');

    console.log('\nStep 4: Deleting clients...');
    const delClients = await prisma.$executeRawUnsafe('DELETE FROM clients');
    console.log(`✅ Deleted ${delClients} clients`);

    console.log('\nStep 5: Deleting products...');
    const delProducts = await prisma.$executeRawUnsafe('DELETE FROM products');
    console.log(`✅ Deleted ${delProducts} products`);

    console.log('\n✨ Database completely wiped!\n');

    const counts = {
      deals: await prisma.deal.count(),
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
    };

    console.log('📊 Verification:');
    Object.entries(counts).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });

    if (Object.values(counts).every(c => c === 0)) {
      console.log('\n🎉 SUCCESS! Database is completely clean!');
    }

    await prisma.$disconnect();
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
