/**
 * Quick verification of debts page numbers
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

async function main() {
  const allDealsAgg = await prisma.$queryRaw<{ client_id: string; company_name: string; net: string }[]>(
    Prisma.sql`
      SELECT c.id as client_id, c.company_name,
        SUM(d.amount - d.paid_amount)::text as net
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
      GROUP BY c.id, c.company_name
    `
  );

  let grossDebt = 0, prepayments = 0;
  for (const row of allDealsAgg) {
    const net = Number(row.net);
    if (net > 0) grossDebt += net;
    else prepayments += net;
  }

  console.log('=== DEBTS PAGE TOTALS ===');
  console.log(`  Валовой долг:  ${fmtNum(grossDebt)}`);
  console.log(`  Предоплаты:    ${fmtNum(prepayments)}`);
  console.log(`  Чистый долг:   ${fmtNum(grossDebt + prepayments)}`);
  console.log(`\n  Excel:`);
  console.log(`  Валовой долг:  1 182 473 663`);
  console.log(`  Предоплаты:    -241 058 500`);
  console.log(`  Чистый:        943 982 063`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
