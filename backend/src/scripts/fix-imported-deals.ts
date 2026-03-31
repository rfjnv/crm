/**
 * Fix imported deals: delete deals that were created from carry-forward rows
 * (i.e., rows whose dates don't match the assigned month).
 *
 * This script:
 *   1. Finds all imported deals (created_at = exactly midnight on 1st of month)
 *   2. Deletes them along with their items, payments, and inventory movements
 *   3. You should then re-import using the fixed import-excel.ts
 *
 * Run:  cd backend && npx tsx src/scripts/fix-imported-deals.ts [year]
 * Then: npx tsx src/scripts/import-excel.ts <excel-file> <year>
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const year = parseInt(process.argv[2] || '2026', 10);
  console.log(`\n=== Cleaning imported deals for ${year} ===\n`);

  // Find all deals with exact midnight first-of-month timestamps (imported deals)
  const importedDeals: { id: string; title: string; created_at: Date; month: number }[] =
    await prisma.$queryRawUnsafe(`
      SELECT id, title, created_at,
        EXTRACT(MONTH FROM created_at)::int as month
      FROM deals
      WHERE EXTRACT(YEAR FROM created_at) = $1
        AND EXTRACT(DAY FROM created_at) = 1
        AND EXTRACT(HOUR FROM created_at) = 0
        AND EXTRACT(MINUTE FROM created_at) = 0
        AND EXTRACT(SECOND FROM created_at) = 0
      ORDER BY created_at, title
    `, year);

  console.log(`Found ${importedDeals.length} imported deals for ${year}`);

  // Group by month for summary
  const byMonth = new Map<number, number>();
  for (const d of importedDeals) {
    byMonth.set(d.month, (byMonth.get(d.month) || 0) + 1);
  }
  for (const [month, count] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  Month ${month}: ${count} deals`);
  }

  if (importedDeals.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  const dealIds = importedDeals.map((d) => d.id);

  // Delete in correct order (foreign key constraints)
  console.log('\nDeleting related records...');

  const invDel = await prisma.inventoryMovement.deleteMany({
    where: { dealId: { in: dealIds } },
  });
  console.log(`  Inventory movements: ${invDel.count} deleted`);

  const payDel = await prisma.payment.deleteMany({
    where: { dealId: { in: dealIds } },
  });
  console.log(`  Payments: ${payDel.count} deleted`);

  const itemsDel = await prisma.dealItem.deleteMany({
    where: { dealId: { in: dealIds } },
  });
  console.log(`  Deal items: ${itemsDel.count} deleted`);

  const dealsDel = await prisma.deal.deleteMany({
    where: { id: { in: dealIds } },
  });
  console.log(`  Deals: ${dealsDel.count} deleted`);

  console.log(`\n=== Done! Deleted ${dealsDel.count} imported deals for ${year} ===`);
  console.log(`Now re-import with: npx tsx src/scripts/import-excel.ts <excel-file> ${year}`);
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
