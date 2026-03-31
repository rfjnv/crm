import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('📊 Анализ долга на 2026-03-17\n');

    // Общий долг: сумма всех closingBalance в DealItems на дату марта 2026
    const totalDebtResult = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT CAST(SUM(CAST(closing_balance AS BIGINT)) AS BIGINT) as total
      FROM deal_items di
      WHERE DATE(di.deal_date) <= '2026-03-17'
    `;

    const totalDebt = totalDebtResult[0]?.total ? Number(totalDebtResult[0].total) : 0;

    // Чистый долг: сумма остатков у непокрытых сделок (paymentStatus = UNPAID или PARTIAL)
    const netDebtResult = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT CAST(SUM(CAST(d.amount AS BIGINT)) AS BIGINT) as total
      FROM deals d
      WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
        AND DATE(d.created_at) <= '2026-03-17'
    `;

    const netDebt = netDebtResult[0]?.total ? Number(netDebtResult[0].total) : 0;

    // По типам платежей
    const byPaymentStatus = await prisma.$queryRaw<
      { status: string; count: bigint; total: bigint }[]
    >`
      SELECT
        d.payment_status as status,
        COUNT(*) as count,
        CAST(SUM(CAST(d.amount AS BIGINT)) AS BIGINT) as total
      FROM deals d
      WHERE DATE(d.created_at) <= '2026-03-17'
      GROUP BY d.payment_status
      ORDER BY total DESC
    `;

    // Топ должников
    const topDebtors = await prisma.$queryRaw<
      { company: string; count: bigint; total: bigint }[]
    >`
      SELECT
        c.company_name as company,
        COUNT(d.id) as count,
        CAST(SUM(CAST(d.amount AS BIGINT)) AS BIGINT) as total
      FROM deals d
      JOIN clients c ON d.client_id = c.id
      WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
        AND DATE(d.created_at) <= '2026-03-17'
      GROUP BY c.id, c.company_name
      ORDER BY total DESC
      LIMIT 10
    `;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('💰 ДОЛГИ НА 17 МАРТА 2026');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`📌 ОБЩИЙ ДОЛГ (сумма всех closing balance на дату):`);
    console.log(`   ${(totalDebt).toLocaleString('ru-RU')} сум\n`);

    console.log(`📌 ЧИСТЫЙ ДОЛГ (непокрытые сделки - UNPAID/PARTIAL):`);
    console.log(`   ${(netDebt).toLocaleString('ru-RU')} сум\n`);

    console.log('─────────────────────────────────────────────────────────────');
    console.log('📊 РАЗБОР ПО СТАТУСУ ПЛАТЕЖА:\n');

    for (const row of byPaymentStatus) {
      const statusLabel = {
        'PAID': '✅ Оплачено',
        'UNPAID': '❌ Не оплачено',
        'PARTIAL': '⚠️ Частичная оплата',
      }[row.status] || row.status;

      console.log(
        `${statusLabel.padEnd(25)} | Сделок: ${String(row.count).padStart(4)} | Сумма: ${Number(row.total).toLocaleString('ru-RU').padStart(15)}`
      );
    }

    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('👥 ТОП 10 ДОЛЖНИКОВ:\n');

    topDebtors.forEach((row, i) => {
      console.log(
        `${i + 1}. ${row.company.padEnd(25)} | ${String(row.count).padStart(2)} сделок | ${Number(row.total).toLocaleString('ru-RU').padStart(15)}`
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
