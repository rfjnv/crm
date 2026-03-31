import prisma from '../lib/prisma';

async function main() {
  const products = await prisma.product.findMany({
    where: { sku: { startsWith: 'IMPORT-' } },
  });

  console.log(`Found ${products.length} products with IMPORT- sku`);

  const allProducts = await prisma.product.findMany({
    select: { id: true, sku: true, name: true },
  });

  const existingSkus = new Set(allProducts.map(p => p.sku));
  
  let duplicates = 0;
  let updated = 0;

  for (const p of products) {
    let newSku = p.name.trim();

    // Ensure it's not empty, though unlikely
    if (!newSku) {
      newSku = p.sku;
    }

    if (existingSkus.has(newSku) && p.sku !== newSku) {
      if (allProducts.find(x => x.sku === newSku && x.id === p.id)) {
        // Same product, shouldn't hit this
      } else {
        duplicates++;
        // find a free sku
        let i = 1;
        while (existingSkus.has(`${newSku}-${i}`)) {
          i++;
        }
        newSku = `${newSku}-${i}`;
      }
    }

    if (p.sku !== newSku) {
      await prisma.product.update({
        where: { id: p.id },
        data: { sku: newSku },
      });
      existingSkus.delete(p.sku);
      existingSkus.add(newSku);
      updated++;
      console.log(`Updated ${p.sku} -> ${newSku}`);
    }
  }

  console.log(`Updated ${updated} products. Encountered ${duplicates} duplicates that were appended with -N.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
