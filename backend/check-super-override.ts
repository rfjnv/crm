import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 2); // looking back 2 days to be safe

  console.log('Searching for OVERRIDE_UPDATE logs after', yesterday);

  const logs = await prisma.auditLog.findMany({
    where: {
      action: 'OVERRIDE_UPDATE',
      entityType: 'deal',
      createdAt: {
        gte: yesterday,
      },
    },
  });

  const matchingDeals = [];

  for (const log of logs) {
    const before = log.before as any;
    const after = log.after as any;

    if (before?.status === 'READY_FOR_SHIPMENT' && after?.status === 'CLOSED') {
      matchingDeals.push({
        dealId: log.entityId,
        logId: log.id,
        createdAt: log.createdAt,
      });
    }
  }

  console.log(`Found ${matchingDeals.length} deals matching the criteria.`);
  
  for (const match of matchingDeals) {
    const deal = await prisma.deal.findUnique({ where: { id: match.dealId } });
    console.log(`Deal ID: ${match.dealId}, Current Status: ${deal?.status}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
