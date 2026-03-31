import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Same calculation as the debts page: per-client, all deals except CANCELED/REJECTED/archived
  const allDealsAgg = await prisma.deal.groupBy({
    by: ['clientId'],
    where: {
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    },
    _sum: { amount: true, paidAmount: true },
  });

  let grossDebt = 0;
  let prepayments = 0;
  for (const row of allDealsAgg) {
    const balance = Number(row._sum.amount ?? 0) - Number(row._sum.paidAmount ?? 0);
    if (balance > 0) grossDebt += balance;
    else prepayments += balance;
  }
  const netDebt = grossDebt + prepayments;

  console.log('=== DEBTS PAGE CALCULATION (per-client, excl CANCELED/REJECTED) ===');
  console.log(`  Gross debt:   ${grossDebt.toLocaleString('ru-RU')}`);
  console.log(`  Prepayments:  ${prepayments.toLocaleString('ru-RU')}`);
  console.log(`  Net debt:     ${netDebt.toLocaleString('ru-RU')}`);

  // Also count the positive and negative clients
  let posClients = 0;
  let negClients = 0;
  let zeroClients = 0;
  for (const row of allDealsAgg) {
    const balance = Number(row._sum.amount ?? 0) - Number(row._sum.paidAmount ?? 0);
    if (balance > 0) posClients++;
    else if (balance < 0) negClients++;
    else zeroClients++;
  }
  console.log(`\n  Positive (debtors): ${posClients}`);
  console.log(`  Negative (prepayments): ${negClients}`);
  console.log(`  Zero: ${zeroClients}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
