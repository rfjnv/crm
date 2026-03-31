/**
 * Backup critical tables (payments + deals) to JSON before sync.
 * These are the only tables modified by sync-payments and reallocate-payments.
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const outDir = path.resolve(__dirname, '../../backups');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

  console.log('Backing up payments...');
  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: 'asc' },
  });
  const paymentsFile = path.join(outDir, `payments-${timestamp}.json`);
  fs.writeFileSync(paymentsFile, JSON.stringify(payments, null, 2));
  console.log(`  ${payments.length} payments → ${paymentsFile}`);

  console.log('Backing up deals (id, amount, paidAmount, paymentStatus)...');
  const deals = await prisma.deal.findMany({
    select: {
      id: true,
      amount: true,
      paidAmount: true,
      paymentStatus: true,
      clientId: true,
      isArchived: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const dealsFile = path.join(outDir, `deals-${timestamp}.json`);
  fs.writeFileSync(dealsFile, JSON.stringify(deals, null, 2));
  console.log(`  ${deals.length} deals → ${dealsFile}`);

  console.log('Backing up monthly snapshots...');
  const snapshots = await prisma.monthlySnapshot.findMany();
  const snapshotsFile = path.join(outDir, `snapshots-${timestamp}.json`);
  fs.writeFileSync(snapshotsFile, JSON.stringify(snapshots, null, 2));
  console.log(`  ${snapshots.length} snapshots → ${snapshotsFile}`);

  console.log('\nBackup complete.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
