import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting mass update of deals...');

  // Target: Deals with title like 'Сделка от 25.03.2026%'
  const deals = await prisma.deal.findMany({
    where: {
      title: {
        contains: 'Сделка от 25.03.2026',
      },
    },
  });

  console.log(`Found ${deals.length} deals to update.`);

  if (deals.length === 0) {
    console.log('No deals found matching the criteria.');
    return;
  }

  // New values
  const newDate = new Date('2026-03-24T12:00:00Z');
  const newTitle = 'Сделка от 24.03.2026';
  const newStatus = 'READY_FOR_SHIPMENT';

  const updatedCount = await prisma.deal.updateMany({
    where: {
      id: {
        in: deals.map(d => d.id),
      },
    },
    data: {
      createdAt: newDate,
      title: newTitle,
      status: newStatus,
    },
  });

  console.log(`Successfully updated ${updatedCount.count} deals.`);
}

main()
  .catch((e) => {
    console.error('Update failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
