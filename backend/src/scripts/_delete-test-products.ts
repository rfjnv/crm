import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all non-IMPORT products (these are test/manually created)
  const testProducts = await prisma.product.findMany({
    where: { NOT: { sku: { startsWith: 'IMPORT-' } } },
    select: { id: true, name: true, sku: true, stock: true },
    orderBy: { name: 'asc' },
  });

  console.log(`=== Test/manual products to delete (${testProducts.length}) ===`);
  testProducts.forEach(p => console.log(`  ${p.sku}  "${p.name}"  stock=${Number(p.stock)}`));

  if (testProducts.length === 0) {
    console.log('Nothing to delete.');
    await prisma.$disconnect();
    return;
  }

  const ids = testProducts.map(p => p.id);

  // Delete related inventory movements first
  const movDeleted = await prisma.inventoryMovement.deleteMany({
    where: { productId: { in: ids } },
  });
  console.log(`\nDeleted ${movDeleted.count} inventory movements`);

  // Delete related deal items
  const dealItemsDeleted = await prisma.dealItem.deleteMany({
    where: { productId: { in: ids } },
  });
  console.log(`Deleted ${dealItemsDeleted.count} deal items`);

  // Delete the products
  const prodDeleted = await prisma.product.deleteMany({
    where: { id: { in: ids } },
  });
  console.log(`Deleted ${prodDeleted.count} products`);

  console.log('\nDone!');
  await prisma.$disconnect();
}

main().catch(console.error);
