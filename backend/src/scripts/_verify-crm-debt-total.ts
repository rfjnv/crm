/**
 * Replicate CRM debts page calculation.
 * Run: cd backend && npx tsx src/scripts/_verify-crm-debt-total.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Method 1: Exact replica of /finance/debts endpoint
  const deals = await prisma.deal.findMany({
    where: {
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    },
    include: {
      client: { select: { id: true, companyName: true } },
    },
  });

  console.log(`Total deals (UNPAID/PARTIAL, non-archived, non-canceled): ${deals.length}`);

  // Aggregate by client
  const clientMap = new Map<string, { name: string; totalDebt: number; dealsCount: number }>();

  for (const deal of deals) {
    const cid = deal.clientId;
    const debt = Number(deal.amount) - Number(deal.paidAmount);

    if (!clientMap.has(cid)) {
      clientMap.set(cid, {
        name: deal.client?.companyName || '',
        totalDebt: 0,
        dealsCount: 0,
      });
    }
    const entry = clientMap.get(cid)!;
    entry.totalDebt += debt;
    entry.dealsCount++;
  }

  const clients = [...clientMap.values()];
  const totalDebt = clients.reduce((s, c) => s + c.totalDebt, 0);
  const totalDealsCount = clients.reduce((s, c) => s + c.dealsCount, 0);

  console.log(`\nClients: ${clients.length}`);
  console.log(`Deals: ${totalDealsCount}`);
  console.log(`Total Debt (exact CRM logic): ${totalDebt.toLocaleString('ru-RU')}`);
  console.log(`Total Debt (raw): ${totalDebt}`);

  // Method 2: SQL - SUM(amount - paidAmount) where status = UNPAID/PARTIAL
  const sqlResult = await prisma.$queryRaw<{ total: string }[]>(Prisma.sql`
    SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as total
    FROM deals d
    WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND d.is_archived = false
  `);
  console.log(`\nSQL total (amount - paidAmount): ${Number(sqlResult[0].total).toLocaleString('ru-RU')}`);

  // Method 3: per-client sum, only positive clients (what user sees)
  const positiveClients = clients.filter(c => c.totalDebt > 0);
  const totalPositive = positiveClients.reduce((s, c) => s + c.totalDebt, 0);
  console.log(`\nClients with positive debt: ${positiveClients.length}`);
  console.log(`Sum of positive client debts: ${totalPositive.toLocaleString('ru-RU')}`);

  // Show all clients sorted by debt
  const sorted = clients.sort((a, b) => b.totalDebt - a.totalDebt);
  console.log(`\nTop 20 clients by debt (from debts page logic):`);
  for (const c of sorted.slice(0, 20)) {
    console.log(`  ${c.name}: ${c.totalDebt.toLocaleString('ru-RU')} (${c.dealsCount} deals)`);
  }

  // Also check: how many deals have paidAmount > amount?
  let negativeDealCount = 0;
  let negativeDealSum = 0;
  for (const deal of deals) {
    const diff = Number(deal.amount) - Number(deal.paidAmount);
    if (diff < 0) {
      negativeDealCount++;
      negativeDealSum += diff;
    }
  }
  console.log(`\nDeals where paidAmount > amount (in UNPAID/PARTIAL!): ${negativeDealCount}`);
  console.log(`Sum of negative diffs: ${negativeDealSum.toLocaleString('ru-RU')}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
