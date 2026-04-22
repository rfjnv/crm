import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fullyCleanDatabase() {
  console.log('\n=== ПОЛНАЯ ОЧИСТКА БАЗЫ (без транзакции из-за foreign keys) ===\n');

  try {
    // Порядок важен - удалять детей перед родителями
    console.log('1. Удаляю messageAttachments...');
    let count = await prisma.messageAttachment.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('2. Удаляю taskAttachments...');
    count = await prisma.taskAttachment.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('3. Удаляю conversationReads...');
    count = await prisma.conversationRead.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('4. Удаляю messages...');
    count = await prisma.message.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('5. Удаляю dealComments...');
    count = await prisma.dealComment.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('6. Удаляю dealItems...');
    count = await prisma.dealItem.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('7. Удаляю shipments...');
    count = await prisma.shipment.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('8. Удаляю notifications...');
    count = await prisma.notification.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('9. Удаляю notificationBatches...');
    count = await prisma.notificationBatch.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('10. Удаляю inventoryMovements...');
    count = await prisma.inventoryMovement.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('11. Удаляю payments...');
    count = await prisma.payment.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('12. Удаляю tasks...');
    count = await prisma.task.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('13. Удаляю auditLogs...');
    count = await prisma.auditLog.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('14. Удаляю expenses...');
    count = await prisma.expense.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('15. Удаляю contracts...');
    count = await prisma.contract.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('16. Удаляю deals...');
    count = await prisma.deal.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('17. Удаляю clients...');
    count = await prisma.client.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('18. Удаляю products...');
    count = await prisma.product.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('19. Удаляю stock...');
    count = await prisma.stock.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    console.log('20. Удаляю sessions...');
    count = await prisma.session.deleteMany();
    console.log(`   ✓ Удалено: ${count.count}`);

    // Verify
    console.log('\n=== ФИНАЛЬНОЕ СОСТОЯНИЕ ===');
    const deals = await prisma.deal.count();
    const items = await prisma.dealItem.count();
    const clients = await prisma.client.count();
    const products = await prisma.product.count();

    console.log(`Deals: ${deals}`);
    console.log(`DealItems: ${items}`);
    console.log(`Clients: ${clients}`);
    console.log(`Products: ${products}`);

    if (deals === 0 && items === 0 && clients === 0 && products === 0) {
      console.log('\n✅ БА З А ПОЛНОСТЬЮ ОЧИЩЕНА!\n');
    }

  } catch (error) {
    console.error('\n❌ Ошибка:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fullyCleanDatabase();
