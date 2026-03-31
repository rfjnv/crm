import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 ПРОВЕРКА ДАННЫХ ПО ГОДАМ:\n');

  const stats = await prisma.$queryRaw`
    SELECT
      EXTRACT(YEAR FROM created_at)::int as year,
      COUNT(*) as deals_count,
      COUNT(DISTINCT client_id) as unique_clients,
      SUM(amount) as total_amount
    FROM deals
    WHERE is_archived = false
    GROUP BY year
    ORDER BY year DESC
  ` as any[];

  console.log('Deals по годам:');
  stats.forEach((s: any) => {
    console.log(`  ${s.year}: ${s.deals_count} deals | ${s.unique_clients} клиентов | сумма: ${Number(s.total_amount || 0).toLocaleString('ru-RU')}`);
  });

  await prisma.$disconnect();
}

main();
