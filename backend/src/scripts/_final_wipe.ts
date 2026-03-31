import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔍 Checking actual database state...\n');

    // Check actual counts using raw SQL
    const [dealCount] = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM deals
    ` as any[];

    const [clientCount] = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM clients
    ` as any[];

    console.log(`Total deals in DB: ${dealCount.count}`);
    console.log(`Total clients in DB: ${clientCount.count}`);

    // If deals still exist, delete them
    if (dealCount.count > 0) {
      console.log('\nDeleting remaining deals first...');
      const result = await prisma.$executeRawUnsafe('DELETE FROM deals');
      console.log(`✅ Deleted ${result} deals`);
    }

    // Disconnect and reconnect to clear any cache
    await prisma.$disconnect();
    const prisma2 = new PrismaClient();

    console.log('\nDeleting clients...');
    const delClients = await prisma2.$executeRawUnsafe('DELETE FROM clients');
    console.log(`✅ Deleted ${delClients} clients`);

    console.log('Deleting products...');
    const delProducts = await prisma2.$executeRawUnsafe('DELETE FROM products');
    console.log(`✅ Deleted ${delProducts} products`);

    console.log('\n✨ Database completely clean!');

    await prisma2.$disconnect();
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
