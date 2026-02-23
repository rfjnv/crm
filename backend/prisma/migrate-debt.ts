/**
 * One-time migration: rename PaymentType.DEBT -> INSTALLMENT
 * Run before prisma db push to avoid data loss.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Update deals that still have DEBT paymentType
  const result = await prisma.$executeRawUnsafe(
    `UPDATE "Deal" SET "paymentType" = 'INSTALLMENT' WHERE "paymentType" = 'DEBT'`
  );
  console.log(`Migrated ${result} deals from DEBT to INSTALLMENT`);
}

main()
  .catch((e) => {
    // If DEBT doesn't exist anymore, the query won't fail — it just updates 0 rows
    console.log('Migration note:', e.message);
  })
  .finally(() => prisma.$disconnect());
