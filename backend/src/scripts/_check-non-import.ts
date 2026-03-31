import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  // All active products NOT starting with IMPORT-
  const nonImport = await prisma.product.findMany({
    where: { isActive: true, NOT: { sku: { startsWith: 'IMPORT-' } } },
    select: { id: true, name: true, sku: true, stock: true, unit: true, format: true, category: true },
    orderBy: { name: 'asc' },
  });
  console.log('Non-IMPORT active products:', nonImport.length);
  console.log('');
  console.log('#  SKU                    Name                          Stock       Unit    Format');
  console.log('-'.repeat(100));
  nonImport.forEach((p, i) => {
    console.log(
      String(i+1).padEnd(3) +
      (p.sku || '').padEnd(25) +
      (p.name || '').substring(0, 28).padEnd(30) +
      String(Number(p.stock)).padStart(10) +
      ('  ' + p.unit).padEnd(8) +
      '  ' + (p.format || '')
    );
  });

  // Also check: are there IMPORT products with same names?
  console.log('\n--- Checking for duplicates (non-IMPORT vs IMPORT with similar names) ---\n');
  const importProducts = await prisma.product.findMany({
    where: { isActive: true, sku: { startsWith: 'IMPORT-' } },
    select: { name: true, sku: true, stock: true },
  });
  const importByName = new Map(importProducts.map(p => [p.name.toLowerCase(), p]));

  for (const ni of nonImport) {
    // Check if there's an IMPORT product with a similar/related name
    const niName = ni.name?.toLowerCase() || '';
    // Try to find by format or partial match
    for (const [impName, impProd] of importByName) {
      if (niName.includes(impName) || impName.includes(niName) ||
          (ni.format && impName === ni.format.toLowerCase())) {
        console.log(`  DUPLICATE? non-IMPORT "${ni.name}" (${ni.sku}, stock=${Number(ni.stock)}) ↔ IMPORT "${impProd.name}" (${impProd.sku}, stock=${Number(impProd.stock)})`);
      }
    }
  }

  await prisma.$disconnect();
}
main();
