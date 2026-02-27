/**
 * One-time script: deactivate all products with SKU starting with IMPORT-.
 * These are historical import artifacts and should not appear in active warehouse views.
 * Idempotent: safe to run multiple times.
 */
import prisma from '../src/lib/prisma';

async function main() {
  const result = await prisma.product.updateMany({
    where: { sku: { startsWith: 'IMPORT-' }, isActive: true },
    data: { isActive: false },
  });
  console.log(`[deactivate-imports] Deactivated ${result.count} IMPORT- products.`);
}

main()
  .catch((err) => {
    console.error('deactivate-imports failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
