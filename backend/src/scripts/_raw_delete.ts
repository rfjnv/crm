import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔥 FORCE DELETE WITH RAW SQL...\n');

    // Delete in proper order using raw SQL
    await prisma.$executeRawUnsafe('DELETE FROM inventory_movements');
    console.log('✅ inventory_movements deleted');

    await prisma.$executeRawUnsafe('DELETE FROM payments');
    console.log('✅ payments deleted');

    await prisma.$executeRawUnsafe('DELETE FROM deal_comments');
    console.log('✅ deal_comments deleted');

    await prisma.$executeRawUnsafe('DELETE FROM deal_items');
    console.log('✅ deal_items deleted');

    await prisma.$executeRawUnsafe('DELETE FROM shipments');
    console.log('✅ shipments deleted');

    await prisma.$executeRawUnsafe('DELETE FROM messages');
    console.log('✅ messages deleted');

    await prisma.$executeRawUnsafe('DELETE FROM deals');
    console.log('✅ deals deleted');

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

    console.log('\n📊 Verification:');
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
