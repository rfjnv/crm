import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 УДАЛЕНИЕ ВСЕХ ДАННЫХ В ПРАВИЛЬНОМ ПОРЯДКЕ...\n');

  try {
    // Delete in order of dependencies
    // First, delete items that reference deals
    console.log('1. Deleting inventory_movements...');
    await prisma.inventoryMovement.deleteMany({});

    console.log('2. Deleting payments...');
    await prisma.payment.deleteMany({});

    console.log('3. Deleting deal_comments...');
    await prisma.dealComment.deleteMany({});

    console.log('4. Deleting deal_items...');
    await prisma.dealItem.deleteMany({});

    console.log('5. Deleting shipments...');
    await prisma.shipment.deleteMany({});

    console.log('6. Deleting messages...');
    await prisma.message.deleteMany({});

    console.log('7. Deleting deals...');
    await prisma.deal.deleteMany({});

    console.log('8. Deleting contracts...');
    await prisma.contract.deleteMany({});

    console.log('9. Deleting clients...');
    await prisma.client.deleteMany({});

    console.log('10. Deleting products...');
    await prisma.product.deleteMany({});

    console.log('\n✅ All data deleted!\n');

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
