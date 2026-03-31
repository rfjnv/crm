import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Check how many deal_items have closingBalance
  const total = await prisma.dealItem.count({ where: { deal: { title: { contains: 'Март 2026' } } } });
  const withCB = await prisma.dealItem.count({ where: { deal: { title: { contains: 'Март 2026' } }, closingBalance: { not: null } } });
  console.log('March items total:', total, ', with closingBalance:', withCB);

  // Now compute the debt totals from closingBalance
  const result = await prisma.$queryRaw<{ net_debt: string; pp_balance: string; gross_debt: string }[]>`
    SELECT
      SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F') THEN COALESCE(di.closing_balance, 0) ELSE 0 END)::text AS net_debt,
      SUM(CASE WHEN di.source_op_type = 'PP' THEN COALESCE(di.closing_balance, 0) ELSE 0 END)::text AS pp_balance,
      SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F','PP') THEN COALESCE(di.closing_balance, 0) ELSE 0 END)::text AS gross_debt
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    WHERE di.closing_balance IS NOT NULL
      AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
  `;
  console.log('\nDebt totals from closingBalance:');
  console.log('  Net debt (K+NK+PK+F):', Math.round(Number(result[0].net_debt)).toLocaleString('ru-RU'));
  console.log('  PP balance:', Math.round(Number(result[0].pp_balance)).toLocaleString('ru-RU'));
  console.log('  Gross debt (K+NK+PK+F+PP):', Math.round(Number(result[0].gross_debt)).toLocaleString('ru-RU'));
  console.log('\nExcel targets:');
  console.log('  Net debt:   1,215,060,263');
  console.log('  Gross debt: 873,005,763');

  // Show top clients by closing_balance
  const topClients = await prisma.$queryRaw<{ company_name: string; net_debt: string; pp: string }[]>`
    SELECT c.company_name,
      SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F') THEN COALESCE(di.closing_balance, 0) ELSE 0 END)::text AS net_debt,
      SUM(CASE WHEN di.source_op_type = 'PP' THEN COALESCE(di.closing_balance, 0) ELSE 0 END)::text AS pp
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    JOIN clients c ON c.id = d.client_id
    WHERE di.closing_balance IS NOT NULL
      AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY c.company_name
    ORDER BY SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F') THEN COALESCE(di.closing_balance, 0) ELSE 0 END) DESC
    LIMIT 10
  `;
  console.log('\nTop 10 clients by net debt (closingBalance):');
  for (const c of topClients) {
    console.log(`  ${c.company_name.padEnd(30)} net: ${Math.round(Number(c.net_debt)).toLocaleString('ru-RU').padStart(15)}  pp: ${Math.round(Number(c.pp)).toLocaleString('ru-RU').padStart(12)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
