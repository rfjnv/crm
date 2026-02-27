/**
 * Deactivate only the 2025 history-import products (SKU like IMPORT-0001).
 * Reactivate the original warehouse imports (SKU like IMPORT-1740571000000-1).
 * Idempotent: safe to run multiple times.
 */
import { Prisma } from '@prisma/client';
import prisma from '../src/lib/prisma';

async function main() {
  // 1. Deactivate only short IMPORT-XXXX products (history/analytics 2025)
  //    These have SKU = 'IMPORT-' + exactly 4 digits (length 11)
  const deactivated = await prisma.$executeRaw(
    Prisma.sql`UPDATE products SET is_active = false, updated_at = NOW()
               WHERE sku ~ '^IMPORT-\\d{4}$' AND is_active = true`,
  );
  console.log(`[deactivate-imports] Deactivated ${deactivated} history-import products (IMPORT-XXXX).`);

  // 2. Reactivate original warehouse imports (IMPORT-{timestamp}-{index})
  //    These have a second dash after IMPORT-
  const reactivated = await prisma.$executeRaw(
    Prisma.sql`UPDATE products SET is_active = true, updated_at = NOW()
               WHERE sku LIKE 'IMPORT-%-_%' AND is_active = false`,
  );
  console.log(`[deactivate-imports] Reactivated ${reactivated} original warehouse-import products.`);
}

main()
  .catch((err) => {
    console.error('deactivate-imports failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
