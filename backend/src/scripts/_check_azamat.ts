import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find азамат андижон
  const client = await prisma.client.findFirst({
    where: { companyName: { contains: 'азамат', mode: 'insensitive' } },
    select: { id: true, companyName: true },
  });
  if (!client) { console.log('Not found'); return; }
  console.log(`Client: ${client.companyName} (${client.id})\n`);

  // All active deals
  const deals = await prisma.deal.findMany({
    where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, amount: true, paidAmount: true, paymentStatus: true, createdAt: true },
  });

  let totalAmount = 0, totalPaid = 0;
  console.log('Deals:');
  for (const d of deals) {
    const amt = Number(d.amount);
    const paid = Number(d.paidAmount);
    const debt = amt - paid;
    totalAmount += amt;
    totalPaid += paid;
    if (Math.abs(debt) > 100) {
      console.log(`  ${d.title.substring(0, 35).padEnd(35)} | amt=${amt.toLocaleString().padStart(14)} | paid=${paid.toLocaleString().padStart(14)} | debt=${debt.toLocaleString().padStart(14)} | ${d.paymentStatus}`);
    }
  }
  console.log(`\n  Total: ${deals.length} deals, amount=${totalAmount.toLocaleString()}, paid=${totalPaid.toLocaleString()}, debt=${(totalAmount - totalPaid).toLocaleString()}`);
  console.log(`  Target debt (Excel): 117,130,000`);
  console.log(`  Excess: ${(totalAmount - totalPaid - 117130000).toLocaleString()}`);

  // Check payments
  const payments = await prisma.payment.findMany({
    where: { clientId: client.id },
    orderBy: { paidAt: 'desc' },
    select: { id: true, amount: true, paidAt: true, note: true, dealId: true },
    take: 20,
  });
  console.log(`\nLast 20 payments:`);
  for (const p of payments) {
    console.log(`  ${Number(p.amount).toLocaleString().padStart(14)} | ${p.paidAt.toISOString().slice(0, 10)} | ${(p.note || '').substring(0, 50)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
