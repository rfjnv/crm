import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 ФИНАЛЬНАЯ ОЧИСТКА (удаление orphaned records)...\n');

  try {
    // Delete all records in all tables
    await prisma.inventoryMovement.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.dealItem.deleteMany({});
    await prisma.deal.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.client.deleteMany({});
    await prisma.product.deleteMany({});

    console.log('✅ All orphaned records deleted\n');

    const counts = {
      deals: await prisma.deal.count(),
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
      dealItems: await prisma.dealItem.count(),
      payments: await prisma.payment.count(),
      movements: await prisma.inventoryMovement.count(),
    };

    console.log('📊 Final state:');
    Object.entries(counts).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });

    if (Object.values(counts).every(c => c === 0)) {
      console.log('\n✨ Database is completely clean!');
    }

    await prisma.$disconnect();
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
