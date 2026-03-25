import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting units of measurement migration...');

  // 1. Update products with unit "бабин" to "бабина"
  const babinRes = await prisma.product.updateMany({
    where: {
      unit: {
        equals: 'бабин',
        mode: 'insensitive',
      },
    },
    data: {
      unit: 'бабина',
    },
  });
  console.log(`Updated ${babinRes.count} products: бабин -> бабина`);

  // 2. Update products with unit "мп" to "п/м"
  const mpRes = await prisma.product.updateMany({
    where: {
      unit: {
        equals: 'мп',
        mode: 'insensitive',
      },
    },
    data: {
      unit: 'п/м',
    },
  });
  console.log(`Updated ${mpRes.count} products: мп -> п/м`);

  console.log('Migration completed successfully.');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
