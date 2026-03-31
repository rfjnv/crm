import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️ УДАЛЯЕМ данные за 2023-2025 (оставляем только 2026)...\n');

  // Найти все deals за 2023-2025
  const toDelete = await prisma.deal.findMany({
    where: {
      createdAt: {
        lt: new Date('2026-01-01'),
      },
    },
    select: { id: true },
  });

  console.log(`📋 Найдено deals за 2023-2025: ${toDelete.length}`);

  if (toDelete.length > 0) {
    const ids = toDelete.map(d => d.id);

    // Удаляем связанные данные в правильном порядке
    console.log('  Удаляем payments...');
    await prisma.payment.deleteMany({
      where: { dealId: { in: ids } },
    });

    console.log('  Удаляем inventoryMovements...');
    await prisma.inventoryMovement.deleteMany({
      where: { dealId: { in: ids } },
    });

    console.log('  Удаляем dealItems...');
    await prisma.dealItem.deleteMany({
      where: { dealId: { in: ids } },
    });

    console.log('  Удаляем deals...');
    await prisma.deal.deleteMany({
      where: { id: { in: ids } },
    });

    console.log('\n✅ Данные за 2023-2025 удалены!');
  }

  // Проверяем что осталось
  const remaining = await prisma.deal.count({
    where: {
      createdAt: { gte: new Date('2026-01-01') },
    },
  });

  console.log(`\n📊 Осталось deals за 2026: ${remaining}`);

  const stats = await prisma.$queryRaw`
    SELECT
      EXTRACT(YEAR FROM created_at)::int as year,
      COUNT (*) as count
    FROM deals
    WHERE is_archived = false
    GROUP BY year
    ORDER BY year
  ` as any[];

  console.log('\nДанные по годам:');
  stats.forEach((s: any) => {
    console.log(`  ${s.year}: ${s.count} deals`);
  });

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('❌ Ошибка:', e);
  process.exit(1);
});
