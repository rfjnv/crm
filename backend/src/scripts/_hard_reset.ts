import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('💥 ЖЕСТКАЯ ОЧИСТКА БД (TRUNCATE)...\n');

  try {
    console.log('Truncating all tables...');

    const tables = [
      'payments',
      'inventory_movements',
      'deal_items',
      'deals',
      'contracts',
      'clients',
      'products',
    ];

    for (const table of tables) {
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${table} CASCADE;`);
        console.log(`  ✅ ${table} truncated`);
      } catch (e: any) {
        console.log(`  ⚠️  ${table}: ${e.message.split('\n')[0]}`);
      }
    }

    console.log('✅ All tables truncated!\n');

    // Verify
    const counts = {
      deals: await prisma.deal.count(),
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
      dealItems: await prisma.dealItem.count(),
      payments: await prisma.payment.count(),
      movements: await prisma.inventoryMovement.count(),
    };

    console.log('📊 Database state after cleanup:');
    Object.entries(counts).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });

    if (Object.values(counts).every(c => c === 0)) {
      console.log('\n✨ Database completely clean!');
    }

    await prisma.$disconnect();
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
