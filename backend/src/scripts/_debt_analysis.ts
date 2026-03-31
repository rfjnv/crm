import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 Дополнительный анализ долга\n');

  // Проверим все коды в базе и их суммы
  console.log('Суммы по кодам платежа:');
  const byCode = await prisma.dealItem.groupBy({
    by: ['sourceOpType'],
    _sum: { closingBalance: true },
    _count: { sourceOpType: true },
  });

  byCode.forEach((item) => {
    const sum = item._sum.closingBalance || 0;
    const count = item._count.sourceOpType || 0;
    console.log(
      `  ${item.sourceOpType.padEnd(8)} | Кол-во: ${String(count).padStart(5)} | Сумма: ${Math.round(sum).toLocaleString('ru-RU').padStart(15)}`
    );
  });

  // Проверим, может быть нужно исключить старые данные (до 2026)
  console.log('\n\nСуммы ТОЛЬКО за 2026 год:');
  const in2026 = await prisma.dealItem.groupBy({
    by: ['sourceOpType'],
    _sum: { closingBalance: true },
    _count: { sourceOpType: true },
    where: {
      dealDate: {
        gte: new Date('2026-01-01'),
        lte: new Date('2026-03-17'),
      },
    },
  });

  in2026.forEach((item) => {
    const sum = item._sum.closingBalance || 0;
    const count = item._count.sourceOpType || 0;
    console.log(
      `  ${item.sourceOpType.padEnd(8)} | Кол-во: ${String(count).padStart(5)} | Сумма: ${Math.round(sum).toLocaleString('ru-RU').padStart(15)}`
    );
  });

  const total2026 = in2026
    .filter((item) => ['K', 'NK', 'PK', 'F', 'К', 'НК', 'ПК', 'Ф'].includes(item.sourceOpType))
    .reduce((sum, item) => sum + (item._sum.closingBalance || 0), 0);

  console.log(`\n\nОбщий долг (К,НК,ПК,Ф) за 2026: ${Math.round(total2026).toLocaleString('ru-RU')}`);

  await prisma.$disconnect();
}

main();
