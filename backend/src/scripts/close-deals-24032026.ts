import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.deal.findMany({
    where: {
      isArchived: false,
      status: { notIn: ['CANCELED', 'REJECTED'] },
      OR: [
        { title: { contains: 'Сделка от 24.03.2026', mode: 'insensitive' } },
        { title: { contains: '2026-03-24' } },
      ],
    },
    select: { id: true, title: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Matched before: ${candidates.length}`);
  for (const d of candidates) {
    console.log(`${d.id.slice(0, 8)} | ${d.title} | ${d.status} | ${d.createdAt.toISOString().slice(0, 10)}`);
  }

  if (candidates.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  const targetDate = new Date('2026-03-23T00:00:00.000Z');
  const ids = candidates.map((d) => d.id);

  await prisma.$transaction(async (tx) => {
    for (const d of candidates) {
      const newTitle = d.title
        .replace(/24\.03\.2026/g, '23.03.2026')
        .replace(/2026-03-24/g, '2026-03-23');

      await tx.deal.update({
        where: { id: d.id },
        data: {
          status: 'CLOSED',
          title: newTitle,
          createdAt: targetDate,
        },
      });
    }
  });

  const after = await prisma.deal.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Updated: ${after.length}`);
  for (const d of after) {
    console.log(`${d.id.slice(0, 8)} | ${d.title} | ${d.status} | ${d.createdAt.toISOString().slice(0, 10)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

