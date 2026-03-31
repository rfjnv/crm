import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const r = await p.$queryRaw<{gross: string, prepay: string, net: string}[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
      COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as prepay,
      COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
    FROM deals d
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
  `);
  console.log('Gross debt:', Number(r[0].gross).toLocaleString());
  console.log('Prepayments:', Number(r[0].prepay).toLocaleString());
  console.log('Net debt:', Number(r[0].net).toLocaleString());

  const clients = await p.$queryRaw<{name: string, debt: string}[]>(Prisma.sql`
    SELECT c.company_name as name, SUM(GREATEST(d.amount - d.paid_amount, 0))::text as debt
    FROM deals d JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
    GROUP BY c.id, c.company_name
    HAVING SUM(GREATEST(d.amount - d.paid_amount, 0)) > 1000
    ORDER BY SUM(GREATEST(d.amount - d.paid_amount, 0)) DESC
    LIMIT 20
  `);
  console.log('\nTop 20 clients by gross debt:');
  for (const c of clients) {
    console.log('  ' + c.name.substring(0, 30).padEnd(30) + ' ' + Number(c.debt).toLocaleString());
  }
}
main().catch(console.error).finally(() => p.$disconnect());
