import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const client = await prisma.client.findFirst({
    where: { companyName: { equals: 'ппс', mode: 'insensitive' } },
    select: { id: true, companyName: true, managerId: true },
  });

  if (!client) throw new Error('Client "ппс" not found');

  let managerId = client.managerId;
  if (!managerId) {
    const anyManager = await prisma.user.findFirst({
      where: { role: 'MANAGER' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!anyManager) throw new Error('No manager found');
    managerId = anyManager.id;
  }

  const deals = await prisma.deal.findMany({
    where: {
      clientId: client.id,
      isArchived: false,
      status: { notIn: ['CANCELED', 'REJECTED'] },
    },
    select: { id: true },
  });
  const dealIds = deals.map((d) => d.id);

  await prisma.$transaction(async (tx) => {
    if (dealIds.length > 0) {
      await tx.payment.deleteMany({ where: { dealId: { in: dealIds } } });
      await tx.inventoryMovement.deleteMany({ where: { dealId: { in: dealIds } } });
      await tx.dealItem.deleteMany({ where: { dealId: { in: dealIds } } });
      await tx.dealComment.deleteMany({ where: { dealId: { in: dealIds } } });
      await tx.shipment.deleteMany({ where: { dealId: { in: dealIds } } });
      await tx.message.deleteMany({ where: { dealId: { in: dealIds } } });
      await tx.deal.deleteMany({ where: { id: { in: dealIds } } });
    }

    const rows = [
      { title: 'ппс - сделка от 2025-10-18', amount: 1_200_000, date: new Date('2025-10-18T00:00:00.000Z') },
      { title: 'ппс - сделка от 2025-11-08', amount: 1_200_000, date: new Date('2025-11-08T00:00:00.000Z') },
      { title: 'ппс - сделка от 2026-03-17', amount: 800_000, date: new Date('2026-03-17T00:00:00.000Z') },
    ];

    for (const r of rows) {
      await tx.deal.create({
        data: {
          title: r.title,
          status: 'IN_PROGRESS',
          amount: r.amount,
          paidAmount: 0,
          paymentStatus: 'UNPAID',
          paymentType: 'FULL',
          paymentMethod: 'TRANSFER',
          clientId: client.id,
          managerId,
          createdAt: r.date,
          updatedAt: r.date,
          isArchived: false,
        },
      });
    }
  });

  const finalDeals = await prisma.deal.findMany({
    where: {
      clientId: client.id,
      isArchived: false,
      status: { notIn: ['CANCELED', 'REJECTED'] },
    },
    select: { amount: true, paidAmount: true },
  });
  const net = finalDeals.reduce((s, d) => s + (Number(d.amount) - Number(d.paidAmount)), 0);

  console.log(`Client: ${client.companyName}`);
  console.log(`Deleted deals: ${dealIds.length}`);
  console.log('Created deals: 3');
  console.log(`Final net debt: ${net}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

