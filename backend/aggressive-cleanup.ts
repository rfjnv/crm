import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function aggressiveCleanup() {
  console.log('\n=== AGGRESSIVE Database Cleanup ===\n');

  try {
    // Delete in correct order considering foreign keys
    
    // Deal-related
    console.log('Deleting dealComments...');
    const dealComments = await prisma.dealComment.deleteMany();
    console.log(`✓ Deleted ${dealComments.count} dealComments`);

    console.log('Deleting dealItems...');
    const dealItems = await prisma.dealItem.deleteMany();
    console.log(`✓ Deleted ${dealItems.count} dealItems`);

    console.log('Deleting shipments...');
    const shipments = await prisma.shipment.deleteMany();
    console.log(`✓ Deleted ${shipments.count} shipments`);

    console.log('Deleting payments...');
    const payments = await prisma.payment.deleteMany();
    console.log(`✓ Deleted ${payments.count} payments`);

    console.log('Deleting inventoryMovements...');
    const invMovements = await prisma.inventoryMovement.deleteMany();
    console.log(`✓ Deleted ${invMovements.count} inventoryMovements`);

    console.log('Deleting deals...');
    const deals = await prisma.deal.deleteMany();
    console.log(`✓ Deleted ${deals.count} deals`);

    console.log('Deleting auditLogs...');
    const auditLogs = await prisma.auditLog.deleteMany();
    console.log(`✓ Deleted ${auditLogs.count} auditLogs`);

    // Verify
    console.log('\n=== Final State ===');
    const finalDeals = await prisma.deal.count();
    const finalItems = await prisma.dealItem.count();
    const finalInv = await prisma.inventoryMovement.count();
    
    console.log(`Deals: ${finalDeals}`);
    console.log(`DealItems: ${finalItems}`);
    console.log(`InventoryMovements: ${finalInv}`);
    
    if (finalDeals === 0 && finalItems === 0 && finalInv === 0) {
      console.log('\n✓ DATABASE COMPLETELY CLEANED!\n');
    } else {
      console.log('\n⚠ Some data remains, checking...\n');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

aggressiveCleanup();
