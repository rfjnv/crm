import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const d1 = await prisma.monthlySnapshot.deleteMany({ where: { year: 2025 } });
  const d2 = await prisma.monthlySnapshot.deleteMany({ where: { year: 2026 } });
  console.log('Deleted 2025 snapshots:', d1.count);
  console.log('Deleted 2026 snapshots:', d2.count);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
