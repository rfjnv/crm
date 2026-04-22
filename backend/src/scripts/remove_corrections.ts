
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Finding all CORRECTION movements...');
  const corrections = await prisma.inventoryMovement.findMany({
    where: { type: 'CORRECTION' },
    include: {
      product: { select: { name: true, sku: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`Found ${corrections.length} correction records.`);

  if (corrections.length > 0) {
    console.log('\nTop 20 corrections by quantity:');
    const sorted = [...corrections].sort((a, b) => Number(b.quantity) - Number(a.quantity));
    sorted.slice(0, 20).forEach(c => {
      console.log(`- Product: ${c.product.name} (${c.product.sku}), Qty: ${c.quantity}, Date: ${c.createdAt.toISOString()}, Note: ${c.note}`);
    });

    console.log('\nDeleting all CORRECTION movements...');
    const deleteResult = await prisma.inventoryMovement.deleteMany({
      where: { type: 'CORRECTION' }
    });
    console.log(`Deleted ${deleteResult.count} movement records.`);

    console.log('\nCleaning up Audit Logs for stock corrections...');
    const auditDeleteResult = await prisma.auditLog.deleteMany({
      where: { entityType: 'stock_correction' }
    });
    console.log(`Deleted ${auditDeleteResult.count} audit log records.`);
    
    // Also delete audit logs for the inventory movements we just deleted
    const invAuditDeleteResult = await prisma.auditLog.deleteMany({
      where: {
        entityType: 'inventory_movement',
        after: {
          path: ['type'],
          equals: 'CORRECTION'
        }
      }
    });
    console.log(`Deleted ${invAuditDeleteResult.count} movement audit logs.`);

  } else {
    console.log('No corrections found to delete.');
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
