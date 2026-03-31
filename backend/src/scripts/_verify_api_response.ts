import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Проверяем текущие расчеты долга в БД...\n');

  // Запрос по этому же коду что в API
  const debtSplit = await prisma.$queryRaw`
    WITH latest_deals AS (
      SELECT DISTINCT ON (d.client_id) d.id AS deal_id
      FROM deals d
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id AND di.closing_balance IS NOT NULL)
      ORDER BY d.client_id, d.created_at DESC
    )
    SELECT
      COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F')
          THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS total_debt_given,
      COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F','PP')
          THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS total_debt_owed
    FROM deal_items di
    JOIN latest_deals ld ON ld.deal_id = di.deal_id
    WHERE di.closing_balance IS NOT NULL
  ` as any[];

  const split = debtSplit[0];
  const totalDebtGiven = Number(split?.total_debt_given ?? 0);
  const totalDebtOwed = Number(split?.total_debt_owed ?? 0);
  const prepayments = totalDebtGiven - totalDebtOwed;

  console.log('📊 Текущие значения в БД:\n');
  console.log(`Общий долг (К+НК+ПК+Ф):     ${totalDebtGiven.toLocaleString('ru-RU')}`);
  console.log(`Чистый долг (К+НК+ПК+Ф+ПП): ${totalDebtOwed.toLocaleString('ru-RU')}`);
  console.log(`Передоплаты:               ${prepayments.toLocaleString('ru-RU')}`);

  console.log('\n✅ Это правильный API ответ что должен приходить на фронтенд');

  await prisma.$disconnect();
}

main();
