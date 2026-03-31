import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Проверим разные варианты расчета

  console.log('Вариант 1: ВСЕ значения closing_balance (все коды)');
  const all = await prisma.$queryRaw`
    SELECT SUM(closing_balance) as total
    FROM deal_items
    WHERE source_op_type IN ('K', 'NK', 'PK', 'F', 'К', 'НК', 'ПК', 'Ф')
  ` as any[];
  console.log(`  Результат: ${Math.round(all[0].total || 0).toLocaleString('ru-RU')}\n`);

  console.log('Вариант 2: ТОЛЬКО положительные closing_balance');
  const positive = await prisma.$queryRaw`
    SELECT SUM(closing_balance) as total
    FROM deal_items
    WHERE source_op_type IN ('K', 'NK', 'PK', 'F', 'К', 'НК', 'ПК', 'Ф')
      AND closing_balance > 0
  ` as any[];
  console.log(`  Результат: ${Math.round(positive[0].total || 0).toLocaleString('ru-RU')}\n`);

  console.log('Вариант 3: Проверим что находится в базе');
  const sample = await prisma.dealItem.findMany({
    where: { sourceOpType: { in: ['K', 'NK', 'PK', 'F', 'К', 'НК', 'ПК', 'Ф'] } },
    take: 20,
    select: { sourceOpType: true, closingBalance: true, dealDate: true },
  });
  console.log('  Примеры:');
  sample.forEach((s, i) => {
    console.log(`    ${i+1}. ${s.sourceOpType} | balance: ${s.closingBalance} | date: ${s.dealDate}`);
  });

  await prisma.$disconnect();
}

main();
