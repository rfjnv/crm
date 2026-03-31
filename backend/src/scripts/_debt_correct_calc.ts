import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 ПРАВИЛЬНЫЙ РАСЧЕТ ДОЛГА (ПОСЛЕДНИЙ closing_balance для каждого клиента):\n');

  // Правильная логика: для каждого клиента берём ПОСЛЕДНЮЮ строку
  // с нужным кодом платежа и считаем её closing_balance

  const debtGiven = await prisma.$queryRaw`
    WITH latest_per_client AS (
      SELECT DISTINCT ON (d.client_id, di.source_op_type)
        d.client_id,
        di.closing_balance,
        di.source_op_type,
        d.created_at
      FROM deal_items di
      JOIN deals d ON di.deal_id = d.id
      WHERE di.source_op_type IN ('K','NK','PK','F','К','НК','ПК','Ф')
        AND di.closing_balance IS NOT NULL
      ORDER BY d.client_id, di.source_op_type, d.created_at DESC
    )
    SELECT
      SUM(COALESCE(closing_balance, 0))::text as total
    FROM latest_per_client
  ` as any[];

  const debtOwed = await prisma.$queryRaw`
    WITH latest_per_client AS (
      SELECT DISTINCT ON (d.client_id, di.source_op_type)
        d.client_id,
        di.closing_balance,
        di.source_op_type,
        d.created_at
      FROM deal_items di
      JOIN deals d ON di.deal_id = d.id
      WHERE di.source_op_type IN ('K','NK','PK','F','PP','К','НК','ПК','Ф','ПП')
        AND di.closing_balance IS NOT NULL
      ORDER BY d.client_id, di.source_op_type, d.created_at DESC
    )
    SELECT
      SUM(COALESCE(closing_balance, 0))::text as total
    FROM latest_per_client
  ` as any[];

  const totalGiven = Number(debtGiven[0]?.total || 0);
  const totalOwed = Number(debtOwed[0]?.total || 0);

  console.log(`Общий долг (К+НК+ПК+Ф):  ${totalGiven.toLocaleString('ru-RU')}`);
  console.log(`Чистый долг (К+НК+ПК+Ф+ПП): ${totalOwed.toLocaleString('ru-RU')}`);
  console.log(`\nОжидаемо из Excel:`);
  console.log(`Общий долг:            1 103 507 863`);
  console.log(`Чистый долг:             770 983 363`);

  await prisma.$disconnect();
}

main();
