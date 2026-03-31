import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('💣 DROPPING FOREIGN KEY CONSTRAINTS...\n');

    // Drop the problematic foreign key constraint
    console.log('Dropping deals_client_id_fkey constraint...');
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE deals DROP CONSTRAINT deals_client_id_fkey`
      );
      console.log('✅ Constraint dropped');
    } catch (error: any) {
      console.log('⚠️  Constraint may not exist or already dropped');
    }

    // Now delete everything
    console.log('\nDeleting all data...');
    await prisma.$executeRawUnsafe('DELETE FROM deal_items');
    console.log('✅ deal_items deleted');

    await prisma.$executeRawUnsafe('DELETE FROM deals');
    console.log('✅ deals deleted');

    await prisma.$executeRawUnsafe('DELETE FROM contracts');
    console.log('✅ contracts deleted');

    await prisma.$executeRawUnsafe('DELETE FROM payments');
    console.log('✅ payments deleted');

    await prisma.$executeRawUnsafe('DELETE FROM inventory_movements');
    console.log('✅ inventory_movements deleted');

    await prisma.$executeRawUnsafe('DELETE FROM clients');
    console.log('✅ clients deleted');

    await prisma.$executeRawUnsafe('DELETE FROM products');
    console.log('✅ products deleted');

    console.log('\n✨ Database clean! Recreating foreign key...');

    // Recreate the foreign key constraint
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE deals ADD CONSTRAINT deals_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT`
      );
      console.log('✅ Constraint recreated');
    } catch (error: any) {
      console.log('⚠️  Could not recreate constraint immediately');
    }

    // Verify
    const counts = {
      deals: await prisma.deal.count(),
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
    };

    console.log('\n📊 Final state:');
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
