import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const clients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  
  let validClients = 0;
  for (const client of clients) {
    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
      select: { id: true, title: true, amount: true, paidAmount: true }
    });
    
    const debts = deals.filter(d => Number(d.amount) > Number(d.paidAmount));
    const credits = deals.filter(d => Number(d.paidAmount) > Number(d.amount));
    
    if (debts.length > 0 && credits.length > 0) {
      console.log(`\nClient: ${client.companyName}`);
      console.log(`  Debts: ${debts.length} (Sum: ${debts.reduce((s,d) => s + (Number(d.amount)-Number(d.paidAmount)), 0)})`);
      console.log(`  Credits: ${credits.length} (Sum: ${credits.reduce((s,d) => s + (Number(d.paidAmount)-Number(d.amount)), 0)})`);
      validClients++;
    }
  }
  
  console.log(`\nFound ${validClients} clients with overlapping debts and credits.`);
}
check().catch(console.error).finally(() => prisma.$disconnect());
