import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 ПРОСТОЙ РАСЧЕТ: SUM(closing_balance) где source_op_type IN (K,NK,PK,F)\n');

  const debtGiven = await prisma.$queryRaw`
    SELECT
      SUM(COALESCE(di.closing_balance, 0))::text as total
    FROM deal_items di
    WHERE di.source_op_type IN ('K','NK','PK','F','К','НК','ПК','Ф')
      AND di.closing_balance IS NOT NULL
  ` as any[];

  const debtOwed = await prisma.$queryRaw`
    SELECT
      SUM(COALESCE(di.closing_balance, 0))::text as total
    FROM deal_items di
    WHERE di.source_op_type IN ('K','NK','PK','F','PP','К','НК','ПК','Ф','ПП')
      AND di.closing_balance IS NOT NULL
  ` as any[];

  const totalGiven = Number(debtGiven[0]?.total || 0);
  const totalOwed = Number(debtOwed[0]?.total || 0);
  const prepayments = totalGiven - totalOwed;

  console.log(`Общий долг:       ${totalGiven.toLocaleString('ru-RU')}`);
  console.log(`Чистый долг:      ${totalOwed.toLocaleString('ru-RU')}`);
  console.log(`Передоплаты:      ${prepayments.toLocaleString('ru-RU')}`);

  console.log(`\n✅ Excel (правильные):`);
  console.log(`Общий долг:       1 103 507 863`);
  console.log(`Чистый долг:        770 983 363`);
  console.log(`Разница:            332 524 500`);

  console.log('\n' + '='.repeat(50));

  // Проверим что вообще есть в базе
  const counts = await prisma.dealItem.groupBy({
    by: ['sourceOpType'],
    _count: true,
    _sum: { closingBalance: true },
  });

  console.log('\n📊 Статистика по source_op_type:');
  counts.forEach(c => {
    const sum = c._sum.closingBalance ? Number(c._sum.closingBalance) : 0;
    console.log(`  ${String(c.sourceOpType || 'NULL').padEnd(10)} | Кол-во: ${String(c._count).padStart(5)} | Сумма: ${sum.toLocaleString('ru-RU')}`);
  });

  await prisma.$disconnect();
}

main();
