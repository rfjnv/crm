import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Проверим: максимальный outstanding balance на 17 марта для каждого клиента
  // Коды: К, Н/К, П/К, Ф (общий долг)

  const debtQuery = await prisma.$queryRaw`
    SELECT
      c.company_name,
      d.id as deal_id,
      MAX(di.closing_balance) as max_balance,
      COUNT(*) as item_count
    FROM deal_items di
    JOIN deals d ON di.deal_id = d.id
    JOIN clients c ON d.client_id = c.id
    WHERE di.source_op_type IN ('K', 'NK', 'PK', 'F')
      AND (di.deal_date IS NULL OR DATE(di.deal_date) <= '2026-03-17')
    GROUP BY c.id, c.company_name, d.id
    ORDER BY max_balance DESC
    LIMIT 20
  ` as any[];

  console.log('ТОП ДОЛЖНИКОВ (последний остаток)');
  console.log('═══════════════════════════════════════\n');

  debtQuery.forEach((row, i) => {
    console.log(`${i + 1}. ${row.company_name.padEnd(35)} | ${row.max_balance?.toLocaleString('ru-RU').padStart(15)}`);
  });

  const total = debtQuery.reduce((sum, row) => sum + (row.max_balance || 0), 0);
  console.log(`\n═══════════════════════════════════════`);
  console.log(`ИТОГО: ${total.toLocaleString('ru-RU')}`);

  await prisma.$disconnect();
}

main();
