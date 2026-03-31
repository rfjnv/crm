import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 Долги только ДЛЯ 2026 ГОДА:\n');

  const debtSplit = await prisma.$queryRaw`
    WITH latest_deals AS (
      SELECT DISTINCT ON (d.client_id) d.id AS deal_id
      FROM deals d
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id AND di.closing_balance IS NOT NULL)
        AND EXTRACT(YEAR FROM d.created_at) = 2026
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
  const totalDebtGiven = Number(split?.total_debt_given || 0);
  const totalDebtOwed = Number(split?.total_debt_owed || 0);
  const prepayments = totalDebtGiven - totalDebtOwed;

  console.log(`Общий долг (2026):    ${totalDebtGiven.toLocaleString('ru-RU')}`);
  console.log(`Чистый долг (2026):   ${totalDebtOwed.toLocaleString('ru-RU')}`);
  console.log(`Передоплаты (2026):   ${prepayments.toLocaleString('ru-RU')}\n`);

  console.log('VВS Excel (17 марта):');
  console.log(`Общий долг Excel:     1 103 507 863`);
  console.log(`Чистый долг Excel:      770 983 363`);

  await prisma.$disconnect();
}

main();
