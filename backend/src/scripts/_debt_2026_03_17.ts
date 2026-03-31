import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 Анализ долга НА 17 МАРТА 2026\n');

  // Общий долг: К, Н/К, П/К, Ф
  const totalDebtQuery = await prisma.$queryRaw`
    SELECT SUM(closing_balance) as total
    FROM deal_items
    WHERE DATE(deal_date) <= '2026-03-17'
      AND source_op_type IN ('K', 'NK', 'PK', 'F', 'К', 'НК', 'ПК', 'Ф')
  ` as { total: number }[];

  const totalDebt = totalDebtQuery[0]?.total ? Number(totalDebtQuery[0].total) : 0;

  // Чистый долг: К, Н/К, П/К, Ф, ПП
  const netDebtQuery = await prisma.$queryRaw`
    SELECT SUM(closing_balance) as total
    FROM deal_items
    WHERE DATE(deal_date) <= '2026-03-17'
      AND source_op_type IN ('K', 'NK', 'PK', 'F', 'PP', 'К', 'НК', 'ПК', 'Ф', 'ПП')
  ` as { total: number }[];

  const netDebt = netDebtQuery[0]?.total ? Number(netDebtQuery[0].total) : 0;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('💰 ДОЛГИ НА 17 МАРТА 2026');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`📌 ОБЩИЙ ДОЛГ (которого мы дали):`);
  console.log(`   Коды: К, Н/К, П/К, Ф`);
  console.log(`   ${Math.round(totalDebt).toLocaleString('ru-RU')} сум\n`);

  console.log(`📌 ЧИСТЫЙ ДОЛГ (который клиенты нам должны):`);
  console.log(`   Коды: К, Н/К, П/К, Ф, ПП`);
  console.log(`   ${Math.round(netDebt).toLocaleString('ru-RU')} сум\n`);

  console.log('═══════════════════════════════════════════════════════════');

  await prisma.$disconnect();
}

main();
