import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const clients = await prisma.client.findMany({
    where: { companyName: { contains: 'принт вел', mode: 'insensitive' } },
  });

  if (clients.length === 0) {
    console.log("Client 'принт вел' not found.");
    return;
  }

  const clientId = clients[0].id;
  console.log(`Found client: ${clients[0].companyName} (${clientId})`);

  const deals = await prisma.deal.findMany({
    where: { clientId, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
    include: { items: { include: { product: true } }, payments: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\nFound ${deals.length} deals:`);
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    const debt = Number(d.amount) - Number(d.paidAmount);
    console.log(`[${i}] Deal ${d.id.slice(0, 5)}... | Date: ${d.createdAt.toISOString().slice(0, 10)} | Title: ${d.title}`);
    console.log(`    Amount: ${d.amount} | Paid: ${d.paidAmount} | Debt: ${debt}`);
    for (const item of d.items) {
      console.log(`      Item: ${item.product.name} | Qty: ${item.requestedQty} | Price: ${item.price} | Total: ${Number(item.requestedQty) * Number(item.price)}`);
    }
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
