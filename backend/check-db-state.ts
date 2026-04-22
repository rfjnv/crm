import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  console.log('\n=== Current DB State ===');
  const deals = await prisma.deal.count();
  const dealItems = await prisma.dealItem.count();
  const payments = await prisma.payment.count();
  const shipments = await prisma.shipment.count();
  const invMovements = await prisma.inventoryMovement.count();
  const contracts = await prisma.contract.count();
  const auditLogs = await prisma.auditLog.count();
  const clients = await prisma.client.count();
  
  console.log('Deals:', deals);
  console.log('DealItems:', dealItems);
  console.log('Payments:', payments);
  console.log('Shipments:', shipments);
  console.log('InventoryMovements:', invMovements);
  console.log('Contracts:', contracts);
  console.log('AuditLogs:', auditLogs);
  console.log('Clients:', clients);
  console.log('');
  
  await prisma.$disconnect();
}

check().catch(console.error);
