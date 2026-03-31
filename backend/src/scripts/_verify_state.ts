import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Overall totals
  const totals = await prisma.$queryRaw<{ gross: string; net: string }[]>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
      FROM deals d
      WHERE d.is_archived = false
    `
  );
  console.log('=== CRM DEBT TOTALS ===');
  console.log(`  Gross debt: ${Number(totals[0].gross).toLocaleString('ru-RU')}`);
  console.log(`  Net debt:   ${Number(totals[0].net).toLocaleString('ru-RU')}`);

  // Prepayments
  const prepayments = await prisma.$queryRaw<{name: string, net: string}[]>(
    Prisma.sql`
      SELECT c.company_name as name,
        SUM(d.amount - d.paid_amount)::text as net
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
      GROUP BY c.id, c.company_name
      HAVING SUM(d.amount - d.paid_amount) < -1
      ORDER BY SUM(d.amount - d.paid_amount) ASC
      LIMIT 30
    `
  );
  console.log(`\n=== PREPAYMENTS (${prepayments.length} clients) ===`);
  let totalPrepay = 0;
  for (const p of prepayments) {
    const net = Number(p.net);
    totalPrepay += net;
    console.log(`  ${p.name}: ${net.toLocaleString('ru-RU')}`);
  }
  console.log(`  Total prepayments: ${totalPrepay.toLocaleString('ru-RU')}`);

  // Top debtors
  const debtors = await prisma.$queryRaw<{name: string, debt: string}[]>(
    Prisma.sql`
      SELECT c.company_name as name,
        SUM(d.amount - d.paid_amount)::text as debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
      GROUP BY c.id, c.company_name
      HAVING SUM(d.amount - d.paid_amount) > 1
      ORDER BY SUM(d.amount - d.paid_amount) DESC
      LIMIT 20
    `
  );
  console.log(`\n=== TOP 20 DEBTORS ===`);
  for (const d of debtors) {
    console.log(`  ${d.name}: ${Number(d.debt).toLocaleString('ru-RU')}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
