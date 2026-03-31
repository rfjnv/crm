import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔥 FORCE DELETE - DISABLE FK CONSTRAINTS...\n');

    // Disable all foreign key constraints temporarily
    await prisma.$executeRawUnsafe(
      `ALTER TABLE deals DISABLE TRIGGER ALL;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clients DISABLE TRIGGER ALL;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE deal_items DISABLE TRIGGER ALL;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE payments DISABLE TRIGGER ALL;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE inventory_movements DISABLE TRIGGER ALL;`
    );

    console.log('Step 1: Foreign key triggers disabled\n');

    // Delete in proper order using raw SQL
    await prisma.$executeRawUnsafe('DELETE FROM inventory_movements');
    console.log('✅ inventory_movements deleted');

    await prisma.$executeRawUnsafe('DELETE FROM deal_comments');
    console.log('✅ deal_comments deleted');

    await prisma.$executeRawUnsafe('DELETE FROM deal_items');
    console.log('✅ deal_items deleted');

    await prisma.$executeRawUnsafe('DELETE FROM payments');
    console.log('✅ payments deleted');

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

    // Re-enable foreign key constraints
    await prisma.$executeRawUnsafe(
      `ALTER TABLE deals ENABLE TRIGGER ALL;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clients ENABLE TRIGGER ALL;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE deal_items ENABLE TRIGGER ALL;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE payments ENABLE TRIGGER ALL;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE inventory_movements ENABLE TRIGGER ALL;`
    );

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
