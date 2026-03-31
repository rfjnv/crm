/**
 * Phase 0: Backup all deals & payments to JSON for rollback.
 *
 * Run:  cd backend && npx tsx src/scripts/rebuild/phase0-backup.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Phase 0: BACKUP ===\n');

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const outDir = path.resolve(process.cwd(), '..', `backup-${timestamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Dump all deals
  console.log('Dumping deals...');
  const deals = await prisma.deal.findMany({
    select: {
      id: true, title: true, status: true, amount: true, paidAmount: true,
      paymentStatus: true, clientId: true, managerId: true, isArchived: true,
      createdAt: true, updatedAt: true,
    },
  });
  fs.writeFileSync(path.join(outDir, 'deals.json'), JSON.stringify(deals, null, 2));
  console.log(`  ${deals.length} deals saved`);

  // 2. Dump all payments
  console.log('Dumping payments...');
  const payments = await prisma.payment.findMany({
    select: {
      id: true, dealId: true, clientId: true, amount: true,
      paidAt: true, method: true, note: true, createdBy: true, createdAt: true,
    },
  });
  fs.writeFileSync(path.join(outDir, 'payments.json'), JSON.stringify(payments, null, 2));
  console.log(`  ${payments.length} payments saved`);

  // 3. Per-client aggregates
  console.log('Dumping per-client aggregates...');
  const clientAgg = await prisma.$queryRaw<
    { client_id: string; company_name: string; deal_count: string; total_amount: string; total_paid: string; net_debt: string }[]
  >(Prisma.sql`
    SELECT c.id as client_id, c.company_name,
      COUNT(d.id)::text as deal_count,
      COALESCE(SUM(d.amount), 0)::text as total_amount,
      COALESCE(SUM(d.paid_amount), 0)::text as total_paid,
      COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net_debt
    FROM deals d JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
    GROUP BY c.id, c.company_name
    ORDER BY c.company_name
  `);
  fs.writeFileSync(path.join(outDir, 'client-aggregates.json'), JSON.stringify(clientAgg, null, 2));
  console.log(`  ${clientAgg.length} clients saved`);

  console.log(`\nBackup saved to: ${outDir}`);
  console.log('Done!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
