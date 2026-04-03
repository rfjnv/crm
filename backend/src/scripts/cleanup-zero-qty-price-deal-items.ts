/**
 * Deletes deal_items where requested_qty and price are both zero (COALESCE),
 * only when the same deal has at least one line with qty > 0 or price > 0.
 *
 * Run: cd backend && npx tsx src/scripts/cleanup-zero-qty-price-deal-items.ts
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

async function runCleanup(): Promise<void> {
  try {
    const deleted = await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM deal_items di
        WHERE COALESCE(di.requested_qty, 0) = 0
          AND COALESCE(di.price, 0) = 0
          AND EXISTS (
            SELECT 1
            FROM deal_items di2
            WHERE di2.deal_id = di.deal_id
              AND (
                COALESCE(di2.requested_qty, 0) > 0
                OR COALESCE(di2.price, 0) > 0
              )
          )
      `,
    );

    const n = typeof deleted === 'bigint' ? Number(deleted) : Number(deleted);
    console.log('Deleted rows:', Number.isFinite(n) ? n : deleted);
  } catch (e) {
    console.error('[cleanup-zero-qty-price-deal-items] failed:', e);
  }
}

runCleanup()
  .catch((e) => {
    console.error('[cleanup-zero-qty-price-deal-items] unexpected:', e);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
