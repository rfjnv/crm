import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Проверяем диапазон дат в deal_items:\n');

  const dateRange = await prisma.$queryRaw`
    SELECT
      MIN(deal_date) as earliest,
      MAX(deal_date) as latest,
      COUNT(*) as total_items
    FROM deal_items
  ` as any[];

  const row = dateRange[0];
  console.log(`Earliest date: ${row.earliest ? new Date(row.earliest).toLocaleDateString('ru-RU') : 'NULL'}`);
  console.log(`Latest date:   ${row.latest ? new Date(row.latest).toLocaleDateString('ru-RU') : 'NULL'}`);
  console.log(`Total items:   ${row.total_items}\n`);

  // Count by year
  const byYear = await prisma.$queryRaw`
    SELECT
      EXTRACT(YEAR FROM deal_date)::int as year,
      COUNT(*) as count
    FROM deal_items
    WHERE deal_date IS NOT NULL
    GROUP BY year
    ORDER BY year
  ` as any[];

  console.log('По годам:');
  byYear.forEach((y: any) => {
    console.log(`  ${y.year}: ${y.count} items`);
  });

  await prisma.$disconnect();
}

main();
