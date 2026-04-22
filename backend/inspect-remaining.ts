import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function inspect() {
  console.log('\n=== Remaining Data ===\n');
  
  const deals = await prisma.deal.findMany({
    include: {
      client: true,
      items: true,
      movements: true,
    }
  });
  
  console.log(`Found ${deals.length} deals:`);
  deals.forEach(d => {
    console.log(`\nDeal ID: ${d.id}`);
    console.log(`  Name: ${d.name}`);
    console.log(`  Status: ${d.status}`);
    console.log(`  Items: ${d.items.length}`);
    console.log(`  MovementsCount: ${d.inventoryMovements.length}`);
  });

  await prisma.$disconnect();
}

inspect().catch(console.error);
