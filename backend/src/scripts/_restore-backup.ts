/**
 * Restore payments and deals from backup JSON files.
 * This undoes sync-payments + reallocate-payments by:
 * 1. Deleting all sync payments (note LIKE '%Сверка CRM%')
 * 2. Restoring deal.paidAmount and deal.paymentStatus from backup
 */
import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

interface BackupDeal {
  id: string;
  amount: any;
  paidAmount: any;
  paymentStatus: string;
  clientId: string;
  isArchived: boolean;
  status: string;
  createdAt: string;
}

interface BackupPayment {
  id: string;
  dealId: string;
  clientId: string;
  amount: any;
  method: string;
  paidAt: string;
  createdBy: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

async function main() {
  const isExecute = process.argv.includes('--execute');
  const backupDir = path.resolve(__dirname, '../../backups');

  // Find latest backup files
  const files = fs.readdirSync(backupDir);
  const paymentsFile = files.filter(f => f.startsWith('payments-') && f.endsWith('.json')).sort().pop();
  const dealsFile = files.filter(f => f.startsWith('deals-') && f.endsWith('.json')).sort().pop();

  if (!paymentsFile || !dealsFile) {
    console.error('Backup files not found!');
    process.exit(1);
  }

  console.log(`=== RESTORE FROM BACKUP ${isExecute ? '** LIVE **' : '(DRY-RUN)'} ===\n`);
  console.log(`Payments backup: ${paymentsFile}`);
  console.log(`Deals backup:    ${dealsFile}`);

  const backupPayments: BackupPayment[] = JSON.parse(
    fs.readFileSync(path.join(backupDir, paymentsFile), 'utf8')
  );
  const backupDeals: BackupDeal[] = JSON.parse(
    fs.readFileSync(path.join(backupDir, dealsFile), 'utf8')
  );

  console.log(`\nBackup contains: ${backupPayments.length} payments, ${backupDeals.length} deals`);

  // Step 1: Count sync payments to delete
  const syncPayments = await prisma.payment.count({
    where: { note: { contains: 'Сверка CRM' } },
  });
  console.log(`\nSync payments to delete: ${syncPayments}`);

  // Step 2: Count deals that need paidAmount/status restoration
  let dealsToRestore = 0;
  const currentDeals = await prisma.deal.findMany({
    select: { id: true, paidAmount: true, paymentStatus: true },
  });
  const currentMap = new Map(currentDeals.map(d => [d.id, d]));

  for (const bd of backupDeals) {
    const current = currentMap.get(bd.id);
    if (!current) continue;
    const backupPaid = Number(bd.paidAmount);
    const currentPaid = Number(current.paidAmount);
    if (Math.abs(backupPaid - currentPaid) > 0.01 || current.paymentStatus !== bd.paymentStatus) {
      dealsToRestore++;
    }
  }
  console.log(`Deals to restore (paidAmount/status changed): ${dealsToRestore}`);

  if (!isExecute) {
    console.log('\nThis was a DRY-RUN. To execute, run with --execute flag.');
    await prisma.$disconnect();
    return;
  }

  // EXECUTE
  console.log('\n--- Executing restore ---');

  // Step 1: Delete sync payments
  console.log('Deleting sync payments...');
  const deleted = await prisma.payment.deleteMany({
    where: { note: { contains: 'Сверка CRM' } },
  });
  console.log(`  Deleted: ${deleted.count} payments`);

  // Step 2: Restore deal paidAmount and paymentStatus from backup
  console.log('Restoring deal paidAmount and paymentStatus...');
  let restored = 0;
  for (const bd of backupDeals) {
    const current = currentMap.get(bd.id);
    if (!current) continue;
    const backupPaid = Number(bd.paidAmount);
    const currentPaid = Number(current.paidAmount);
    if (Math.abs(backupPaid - currentPaid) > 0.01 || current.paymentStatus !== bd.paymentStatus) {
      await prisma.deal.update({
        where: { id: bd.id },
        data: {
          paidAmount: new Prisma.Decimal(bd.paidAmount),
          paymentStatus: bd.paymentStatus as any,
        },
      });
      restored++;
      if (restored % 100 === 0) console.log(`  ... restored ${restored}/${dealsToRestore}`);
    }
  }
  console.log(`  Restored: ${restored} deals`);

  // Verify
  const postGross = await prisma.$queryRaw<{ v: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(GREATEST(amount - COALESCE(paid_amount,0),0)),0)::text as v FROM deals WHERE is_archived = false`
  );
  const postNet = await prisma.$queryRaw<{ v: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0)::text as v FROM deals WHERE is_archived = false`
  );
  const postPayments = await prisma.payment.count();

  console.log(`\n=== POST-RESTORE STATE ===`);
  console.log(`Payments total: ${postPayments}`);
  console.log(`Gross debt:     ${Number(postGross[0].v).toLocaleString('ru-RU')}`);
  console.log(`Net debt:       ${Number(postNet[0].v).toLocaleString('ru-RU')}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
