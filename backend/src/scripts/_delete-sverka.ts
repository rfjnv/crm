import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find all "Сверка" deals
  const sverka = await prisma.deal.findMany({
    where: { title: { contains: 'Сверка' } },
    include: {
      items: { select: { id: true } },
      payments: { select: { id: true } },
      client: { select: { companyName: true } },
    },
  });

  console.log(`Found ${sverka.length} Сверка deals:\n`);
  for (const d of sverka) {
    const bal = Number(d.amount) - Number(d.paidAmount);
    console.log(`  "${d.title}"`);
    console.log(`    client: ${d.client?.companyName}`);
    console.log(`    amount=${Number(d.amount).toLocaleString('ru-RU')} paid=${Number(d.paidAmount).toLocaleString('ru-RU')} balance=${bal.toLocaleString('ru-RU')}`);
    console.log(`    items=${d.items.length} payments=${d.payments.length}`);
    console.log(`    id=${d.id}`);
  }

  if (sverka.length === 0) {
    console.log('No Сверка deals found.');
    return;
  }

  // Delete them
  const ids = sverka.map(d => d.id);

  console.log(`\nDeleting ${ids.length} Сверка deals...`);

  // Delete related data first
  const delPayments = await prisma.payment.deleteMany({ where: { dealId: { in: ids } } });
  console.log(`  Payments deleted: ${delPayments.count}`);

  const delMovements = await prisma.inventoryMovement.deleteMany({ where: { dealId: { in: ids } } });
  console.log(`  Movements deleted: ${delMovements.count}`);

  const delItems = await prisma.dealItem.deleteMany({ where: { dealId: { in: ids } } });
  console.log(`  Items deleted: ${delItems.count}`);

  const delDeals = await prisma.deal.deleteMany({ where: { id: { in: ids } } });
  console.log(`  Deals deleted: ${delDeals.count}`);

  console.log('\nDone!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
