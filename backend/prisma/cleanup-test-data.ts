import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('\n=== Cleanup Test Data ===');
  console.log('Deleting: deals, payments, contracts, audit logs, chats, tasks, inventory movements');
  console.log('Preserving: clients, products (with stock), users\n');

  await prisma.$transaction(async (tx) => {
    // Task-related
    const taskAttachments = await tx.taskAttachment.deleteMany();
    console.log(`  Deleted taskAttachments: ${taskAttachments.count}`);
    const tasks = await tx.task.deleteMany();
    console.log(`  Deleted tasks: ${tasks.count}`);

    // Expenses
    const expenses = await tx.expense.deleteMany();
    console.log(`  Deleted expenses: ${expenses.count}`);

    // Chat
    const msgAttachments = await tx.messageAttachment.deleteMany();
    console.log(`  Deleted messageAttachments: ${msgAttachments.count}`);
    const convReads = await tx.conversationRead.deleteMany();
    console.log(`  Deleted conversationReads: ${convReads.count}`);
    const messages = await tx.message.deleteMany();
    console.log(`  Deleted messages: ${messages.count}`);

    // Notifications
    const notifications = await tx.notification.deleteMany();
    console.log(`  Deleted notifications: ${notifications.count}`);
    const notifBatches = await tx.notificationBatch.deleteMany();
    console.log(`  Deleted notificationBatches: ${notifBatches.count}`);

    // Deal children
    const dealComments = await tx.dealComment.deleteMany();
    console.log(`  Deleted dealComments: ${dealComments.count}`);
    const dealItems = await tx.dealItem.deleteMany();
    console.log(`  Deleted dealItems: ${dealItems.count}`);
    const shipments = await tx.shipment.deleteMany();
    console.log(`  Deleted shipments: ${shipments.count}`);
    const payments = await tx.payment.deleteMany();
    console.log(`  Deleted payments: ${payments.count}`);
    const invMovements = await tx.inventoryMovement.deleteMany();
    console.log(`  Deleted inventoryMovements: ${invMovements.count}`);

    // Unlink daily closings from deals
    await tx.deal.updateMany({ data: { dailyClosingId: null } });
    const dailyClosings = await tx.dailyClosing.deleteMany();
    console.log(`  Deleted dailyClosings: ${dailyClosings.count}`);

    // Deals and contracts
    const deals = await tx.deal.deleteMany();
    console.log(`  Deleted deals: ${deals.count}`);
    const contracts = await tx.contract.deleteMany();
    console.log(`  Deleted contracts: ${contracts.count}`);

    // Audit logs
    const auditLogs = await tx.auditLog.deleteMany();
    console.log(`  Deleted auditLogs: ${auditLogs.count}`);
  });

  // Verify preserved data
  const clientCount = await prisma.client.count();
  const productCount = await prisma.product.count();
  const userCount = await prisma.user.count();

  console.log('\n=== Preserved Data ===');
  console.log(`  Clients:  ${clientCount}`);
  console.log(`  Products: ${productCount}`);
  console.log(`  Users:    ${userCount}`);
  console.log('\n=== Cleanup Complete ===\n');
}

main()
  .catch((err) => {
    console.error('Cleanup error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
