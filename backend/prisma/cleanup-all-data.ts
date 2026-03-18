import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  ПОЛНАЯ ОЧИСТКА ДАННЫХ CRM');
  console.log('═══════════════════════════════════════\n');

  // 1. Messages & attachments
  console.log('[1/10] Удаление сообщений...');
  const msgAtt = await prisma.messageAttachment.deleteMany();
  const msgs = await prisma.message.deleteMany();
  const convReads = await prisma.conversationRead.deleteMany();
  console.log(`  ✓ ${msgAtt.count} вложений, ${msgs.count} сообщений, ${convReads.count} прочтений\n`);

  // 2. Payments
  console.log('[2/10] Удаление платежей...');
  const payments = await prisma.payment.deleteMany();
  console.log(`  ✓ ${payments.count} платежей\n`);

  // 3. Inventory movements
  console.log('[3/10] Удаление движений склада...');
  const movements = await prisma.inventoryMovement.deleteMany();
  console.log(`  ✓ ${movements.count} движений\n`);

  // 4. Deal items, comments, shipments
  console.log('[4/10] Удаление позиций сделок...');
  const items = await prisma.dealItem.deleteMany();
  const comments = await prisma.dealComment.deleteMany();
  const shipments = await prisma.shipment.deleteMany();
  console.log(`  ✓ ${items.count} позиций, ${comments.count} комментариев, ${shipments.count} отгрузок\n`);

  // 5. Deals
  console.log('[5/10] Удаление сделок...');
  const deals = await prisma.deal.deleteMany();
  console.log(`  ✓ ${deals.count} сделок\n`);

  // 6. Contracts & related
  console.log('[6/10] Удаление договоров...');
  const poa = await prisma.powerOfAttorney.deleteMany();
  const contractAtt = await prisma.contractAttachment.deleteMany();
  const contracts = await prisma.contract.deleteMany();
  console.log(`  ✓ ${contracts.count} договоров, ${poa.count} доверенностей, ${contractAtt.count} вложений\n`);

  // 7. Clients
  console.log('[7/10] Удаление клиентов...');
  const clients = await prisma.client.deleteMany();
  console.log(`  ✓ ${clients.count} клиентов\n`);

  // 8. Products (all including IMPORT-)
  console.log('[8/10] Удаление товаров...');
  const products = await prisma.product.deleteMany();
  console.log(`  ✓ ${products.count} товаров\n`);

  // 9. Snapshots & audit logs
  console.log('[9/10] Удаление снимков и логов...');
  const snapshots = await prisma.monthlySnapshot.deleteMany();
  const auditLogs = await prisma.auditLog.deleteMany();
  console.log(`  ✓ ${snapshots.count} снимков, ${auditLogs.count} логов аудита\n`);

  // 10. Notifications
  console.log('[10/10] Удаление уведомлений...');
  const notifs = await prisma.notification.deleteMany();
  const notifBatches = await prisma.notificationBatch.deleteMany();
  console.log(`  ✓ ${notifs.count} уведомлений, ${notifBatches.count} пакетов\n`);

  console.log('═══════════════════════════════════════');
  console.log('  ОЧИСТКА ЗАВЕРШЕНА');
  console.log('  Пользователи и настройки сохранены');
  console.log('═══════════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('Ошибка очистки:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
