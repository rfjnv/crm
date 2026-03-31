import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Get all march deal items with closingBalance, grouped by source_op_type
  const result = await prisma.$queryRaw<{ op_type: string; total: string; cnt: string }[]>`
    SELECT
      COALESCE(di.source_op_type, 'NULL') AS op_type,
      SUM(COALESCE(di.closing_balance, 0))::text AS total,
      COUNT(*)::text AS cnt
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    WHERE d.title LIKE '%Март 2026%'
      AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY COALESCE(di.source_op_type, 'NULL')
    ORDER BY SUM(COALESCE(di.closing_balance, 0)) DESC
  `;

  console.log('closingBalance by opType (March 2026 items):');
  let totalDebt = 0;
  let totalPP = 0;
  for (const r of result) {
    const total = Number(r.total);
    console.log(`  ${r.op_type.padEnd(10)} items: ${r.cnt.padStart(5)}  total: ${Math.round(total).toLocaleString('ru-RU').padStart(15)}`);
    if (['K','NK','PK','F'].includes(r.op_type)) totalDebt += total;
    if (r.op_type === 'PP') totalPP += total;
  }
  console.log(`\nNet debt (K+NK+PK+F): ${Math.round(totalDebt).toLocaleString('ru-RU')}`);
  console.log(`PP: ${Math.round(totalPP).toLocaleString('ru-RU')}`);
  console.log(`Gross: ${Math.round(totalDebt + totalPP).toLocaleString('ru-RU')}`);

  // Check total number of deal_items with closing_balance IS NULL
  const withNull = await prisma.dealItem.count({
    where: { deal: { title: { contains: 'Март 2026' } }, closingBalance: null },
  });
  const withVal = await prisma.dealItem.count({
    where: { deal: { title: { contains: 'Март 2026' } }, closingBalance: { not: null } },
  });
  console.log(`\nItems with closingBalance: ${withVal}, without: ${withNull}`);

  // How many total items were imported
  const totalItems = await prisma.dealItem.count({
    where: { deal: { title: { contains: 'Март 2026' } } },
  });
  console.log(`Total items: ${totalItems}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
