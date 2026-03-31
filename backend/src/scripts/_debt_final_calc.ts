import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 ТРЕТИЙ ВАРИАНТ: Для каждого клиента - ПОСЛЕДНЯЯ строка на 17 марта\n');

  // Для каждого клиента найдём ПОСЛЕДНИЙ deal_item на 17 марта 2026с кодом К,НК,ПК,Ф
  const debtGiven = await prisma.$queryRaw`
    WITH latest_per_client AS (
      SELECT DISTINCT ON (d.client_id)
        d.client_id,
        di.closing_balance,
        di.source_op_type,
        d.created_at
      FROM deal_items di
      JOIN deals d ON di.deal_id = d.id
      WHERE di.source_op_type IN ('K','NK','PK','F','К','НК','ПК','Ф')
        AND DATE(d.created_at) <= '2026-03-17'
        AND di.closing_balance IS NOT NULL
      ORDER BY d.client_id, d.created_at DESC
    )
    SELECT
      SUM(COALESCE(closing_balance, 0)) as total
    FROM latest_per_client
  ` as any[];

  const debtOwed = await prisma.$queryRaw`
    WITH latest_per_client AS (
      SELECT DISTINCT ON (d.client_id)
        d.client_id,
        di.closing_balance,
        di.source_op_type,
        d.created_at
      FROM deal_items di
      JOIN deals d ON di.deal_id = d.id
      WHERE di.source_op_type IN ('K','NK','PK','F','PP','К','НК','ПК','Ф','ПП')
        AND DATE(d.created_at) <= '2026-03-17'
        AND di.closing_balance IS NOT NULL
      ORDER BY d.client_id, d.created_at DESC
    )
    SELECT
      SUM(COALESCE(closing_balance, 0)) as total
    FROM latest_per_client
  ` as any[];

  const totalGiven = Number(debtGiven[0]?.total || 0);
  const totalOwed = Number(debtOwed[0]?.total || 0);

  console.log(`Общий долг:       ${totalGiven.toLocaleString('ru-RU')}`);
  console.log(`Чистый долг:      ${totalOwed.toLocaleString('ru-RU')}`);
  console.log(`\n✅ Ожидаемо из Excel:`);
  console.log(`Общий долг:       1 103 507 863`);
  console.log(`Чистый долг:        770 983 363`);

  await prisma.$disconnect();
}

main();
