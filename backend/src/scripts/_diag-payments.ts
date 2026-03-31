import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const totalPayments = await prisma.$queryRawUnsafe<{cnt: string, total: string}[]>(
    'SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM payments'
  );
  console.log('All payments:', totalPayments[0].cnt, 'records, total:', Number(totalPayments[0].total).toLocaleString());

  const sverka = await prisma.$queryRawUnsafe<{cnt: string, total: string}[]>(
    "SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM payments WHERE note LIKE 'Сверка%'"
  );
  console.log('Sverka payments:', sverka[0].cnt, 'records, total:', Number(sverka[0].total).toLocaleString());

  const nonSverka = await prisma.$queryRawUnsafe<{cnt: string, total: string}[]>(
    "SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM payments WHERE note IS NULL OR note NOT LIKE 'Сверка%'"
  );
  console.log('Real payments:', nonSverka[0].cnt, 'records, total:', Number(nonSverka[0].total).toLocaleString());

  const imported = await prisma.$queryRawUnsafe<{cnt: string, total: string}[]>(
    "SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM payments WHERE note LIKE '%import%' OR note LIKE '%xlsx%' OR note LIKE '%Excel%'"
  );
  console.log('Import-tagged payments:', imported[0].cnt, 'records, total:', Number(imported[0].total).toLocaleString());

  const byYear = await prisma.$queryRawUnsafe<{yr: number, cnt: string, total: string}[]>(
    'SELECT EXTRACT(YEAR FROM paid_at)::int as yr, COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM payments GROUP BY yr ORDER BY yr'
  );
  console.log('\nPayments by year:');
  for (const r of byYear) {
    console.log('  ' + r.yr + ': ' + r.cnt + ' records, total: ' + Number(r.total).toLocaleString());
  }

  const dupes = await prisma.$queryRawUnsafe<{cnt: string}[]>(
    'SELECT COUNT(*)::text as cnt FROM (SELECT deal_id, amount, DATE(paid_at) as d, COUNT(*) as c FROM payments GROUP BY deal_id, amount, DATE(paid_at) HAVING COUNT(*) > 1) x'
  );
  console.log('\nDuplicate payment groups (same deal+amount+date):', dupes[0].cnt);

  // How much is in deals.amount total
  const dealsTotal = await prisma.$queryRawUnsafe<{cnt: string, total_amount: string, total_paid: string}[]>(
    "SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total_amount, COALESCE(SUM(paid_amount),0)::text as total_paid FROM deals WHERE is_archived = false AND status NOT IN ('CANCELED','REJECTED')"
  );
  console.log('\nActive deals:', dealsTotal[0].cnt);
  console.log('  SUM(amount):', Number(dealsTotal[0].total_amount).toLocaleString());
  console.log('  SUM(paid_amount):', Number(dealsTotal[0].total_paid).toLocaleString());
  console.log('  Debt (amount-paid):', (Number(dealsTotal[0].total_amount) - Number(dealsTotal[0].total_paid)).toLocaleString());
}

main().catch(console.error).finally(() => prisma.$disconnect());
