import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Top clients by absolute debt
  const rows = await prisma.$queryRaw<{company_name: string, deal_count: string, total_amount: string, total_paid: string, net: string}[]>(
    Prisma.sql`
      SELECT c.company_name, COUNT(d.id)::text as deal_count,
        COALESCE(SUM(d.amount),0)::text as total_amount,
        COALESCE(SUM(d.paid_amount),0)::text as total_paid,
        COALESCE(SUM(d.amount - d.paid_amount),0)::text as net
      FROM deals d JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
      GROUP BY c.id, c.company_name
      HAVING ABS(SUM(d.amount - d.paid_amount)) > 1000000
      ORDER BY ABS(SUM(d.amount - d.paid_amount)) DESC
      LIMIT 30
    `
  );

  console.log('Top 30 clients by |debt|:');
  for (const r of rows) {
    console.log(
      r.company_name.substring(0, 30).padEnd(30) + ' | ' +
      r.deal_count.padStart(4) + ' deals | ' +
      'amt=' + Number(r.total_amount).toLocaleString().padStart(16) + ' | ' +
      'paid=' + Number(r.total_paid).toLocaleString().padStart(16) + ' | ' +
      'debt=' + Number(r.net).toLocaleString().padStart(16)
    );
  }

  // After sync, CRM-only clients will still have debt.
  // How much is from CRM-only (not in latest Excel)?
  // Count deals per client - if a client has many deals per month, it's likely duplication
  const dupDeals = await prisma.$queryRaw<{cnt: string, total_amount: string}[]>(
    Prisma.sql`
      SELECT COUNT(*)::text as cnt, SUM(amount)::text as total_amount FROM (
        SELECT d.client_id, d.title, COUNT(*) as dup_count, SUM(d.amount) as amount
        FROM deals d
        WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
        GROUP BY d.client_id, d.title
        HAVING COUNT(*) > 1
      ) x
    `
  );
  console.log('\nDuplicate deal groups (same client+title, count>1):', dupDeals[0].cnt);
  console.log('Total amount in duplicate deals:', Number(dupDeals[0].total_amount).toLocaleString());
}

main().catch(console.error).finally(() => prisma.$disconnect());
