import app from './app';
import { config } from './lib/config';
import prisma from './lib/prisma';
import { importProductsIfNeeded } from './lib/startup-import';
import fs from 'fs';
import path from 'path';

async function main() {
  // Ensure uploads directory exists
  const uploadsDir = path.resolve(config.uploads.dir);
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Verify DB connection
  await prisma.$connect();
  console.log('Database connected');

  // Auto-import products from Excel on first run (skipped if products already exist)
  await importProductsIfNeeded();

  // One-time cleanup via env var (set RUN_CLEANUP=true in Render, then remove after deploy)
  if (process.env.RUN_CLEANUP === 'true') {
    console.log('RUN_CLEANUP=true detected. Cleaning up business data...');
    await prisma.$transaction(async (tx) => {
      await tx.taskAttachment.deleteMany();
      await tx.task.deleteMany();
      await tx.expense.deleteMany();
      await tx.messageAttachment.deleteMany();
      await tx.conversationRead.deleteMany();
      await tx.message.deleteMany();
      await tx.notification.deleteMany();
      await tx.notificationBatch.deleteMany();
      await tx.dealComment.deleteMany();
      await tx.dealItem.deleteMany();
      await tx.shipment.deleteMany();
      await tx.payment.deleteMany();
      await tx.inventoryMovement.deleteMany();
      await tx.deal.deleteMany();
      await tx.contract.deleteMany();
      await tx.auditLog.deleteMany();
    });
    const clients = await prisma.client.count();
    const products = await prisma.product.count();
    const users = await prisma.user.count();
    console.log(`Cleanup done. Preserved: ${clients} clients, ${products} products, ${users} users`);
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${config.port} [${config.nodeEnv}]`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
