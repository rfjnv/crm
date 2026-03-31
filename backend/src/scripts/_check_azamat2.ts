import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find all matching clients
  const clients = await prisma.client.findMany({
    where: { OR: [
      { companyName: { contains: 'азамат', mode: 'insensitive' } },
      { companyName: { contains: 'андижон', mode: 'insensitive' } },
    ]},
    select: { id: true, companyName: true },
  });
  console.log('Matching clients:');
  for (const c of clients) console.log(`  ${c.companyName} (${c.id})`);

  // Check each for debt
  for (const client of clients) {
    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, amount: true, paidAmount: true, paymentStatus: true },
    });
    const totalDebt = deals.reduce((s, d) => s + Number(d.amount) - Number(d.paidAmount), 0);
    if (Math.abs(totalDebt) > 1000) {
      console.log(`\n${client.companyName}: ${deals.length} deals, debt=${totalDebt.toLocaleString()}`);
      for (const d of deals) {
        const debt = Number(d.amount) - Number(d.paidAmount);
        if (Math.abs(debt) > 100) {
          console.log(`  ${d.title.padEnd(40)} | amt=${Number(d.amount).toLocaleString().padStart(14)} | paid=${Number(d.paidAmount).toLocaleString().padStart(14)} | debt=${debt.toLocaleString().padStart(14)} | ${d.paymentStatus}`);
        }
      }
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
