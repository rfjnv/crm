import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('📊 Анализ долга на 2026-03-17 (ПРАВИЛЬНЫЙ РАСЧЕТ)\n');

    // Общий долг: Сумма Column AA где Column J = к, н/к, п/к, ф
    const totalDebtResult = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT CAST(SUM(CAST(closing_balance AS BIGINT)) AS BIGINT) as total
      FROM deal_items di
      WHERE DATE(di.deal_date) <= '2026-03-17'
        AND di.source_op_type IN ('K', 'NK', 'PK', 'F')
    `;

    const totalDebt = totalDebtResult[0]?.total ? Number(totalDebtResult[0].total) : 0;

    // Чистый долг: Сумма Column AA где Column J = к, н/к, п/к, ф, пп
    const netDebtResult = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT CAST(SUM(CAST(closing_balance AS BIGINT)) AS BIGINT) as total
      FROM deal_items di
      WHERE DATE(di.deal_date) <= '2026-03-17'
        AND di.source_op_type IN ('K', 'NK', 'PK', 'F', 'PP')
    `;

    const netDebt = netDebtResult[0]?.total ? Number(netDebtResult[0].total) : 0;

    // Разница
    const prepayment = totalDebt - netDebt;

    // Топ должников (Total debt)
    const topDebtors = await prisma.$queryRaw<
      { company: string; total: bigint }[]
    >`
      SELECT
        c.company_name as company,
        CAST(SUM(CAST(di.closing_balance AS BIGINT)) AS BIGINT) as total
      FROM deal_items di
      JOIN deals d ON di.deal_id = d.id
      JOIN clients c ON d.client_id = c.id
      WHERE DATE(di.deal_date) <= '2026-03-17'
        AND di.source_op_type IN ('K', 'NK', 'PK', 'F')
      GROUP BY c.id, c.company_name
      ORDER BY total DESC
      LIMIT 10
    `;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('💰 ДОЛГИ НА 17 МАРТА 2026 (ПРАВИЛЬНЫЙ РАСЧЕТ)');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`📌 ОБЩИЙ ДОЛГ (которого мы дали):`);
    console.log(`   Коды: К, Н/К, П/К, Ф`);
    console.log(`   ${(totalDebt).toLocaleString('ru-RU')} сум\n`);

    console.log(`📌 ЧИСТЫЙ ДОЛГ (который клиенты нам должны):`);
    console.log(`   Коды: К, Н/К, П/К, Ф, ПП`);
    console.log(`   ${(netDebt).toLocaleString('ru-RU')} сум\n`);

    console.log(`📌 ПЕРЕДОПЛАТЫ (разница):`);
    console.log(`   ${(Math.abs(prepayment)).toLocaleString('ru-RU')} сум\n`);

    console.log('─────────────────────────────────────────────────────────────');
    console.log('👥 ТОП ДОЛЖНИКОВ (Общий долг - К, Н/К, П/К, Ф):\n');

    topDebtors.forEach((row, i) => {
      console.log(
        `${i + 1}. ${row.company.padEnd(30)} | ${Number(row.total).toLocaleString('ru-RU').padStart(15)}`
      );
    });

    console.log('\n═══════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
