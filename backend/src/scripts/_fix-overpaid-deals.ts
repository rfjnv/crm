/**
 * Fix deals where paidAmount >= amount but paymentStatus is still UNPAID/PARTIAL.
 * These are data integrity errors — if fully paid, status should be PAID.
 *
 * Run: cd backend && npx tsx src/scripts/_fix-overpaid-deals.ts          # dry-run
 *      cd backend && npx tsx src/scripts/_fix-overpaid-deals.ts --execute # live
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(70));
  console.log(`  FIX OVERPAID DEALS  ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(70));

  // Find deals where paidAmount >= amount but status is UNPAID or PARTIAL
  const deals = await prisma.deal.findMany({
    where: {
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      isArchived: false,
    },
    include: {
      client: { select: { companyName: true } },
    },
  });

  const overpaid = deals.filter(d => Number(d.paidAmount) >= Number(d.amount));

  console.log(`\nTotal UNPAID/PARTIAL deals: ${deals.length}`);
  console.log(`Deals where paidAmount >= amount: ${overpaid.length}`);

  if (overpaid.length === 0) {
    console.log('No overpaid deals found. Nothing to fix.');
    return;
  }

  let totalExcess = 0;
  const byClient = new Map<string, { name: string; count: number; excess: number }>();

  for (const d of overpaid) {
    const excess = Number(d.paidAmount) - Number(d.amount);
    totalExcess += excess;
    const name = d.client?.companyName || 'unknown';
    const existing = byClient.get(d.clientId) || { name, count: 0, excess: 0 };
    existing.count++;
    existing.excess += excess;
    byClient.set(d.clientId, existing);
  }

  console.log(`Total excess (paid - amount): ${totalExcess.toLocaleString('ru-RU')} сум`);
  console.log(`\nClients affected: ${byClient.size}`);

  // Show top 20 by excess
  const sorted = [...byClient.values()].sort((a, b) => b.excess - a.excess);
  console.log('\nTop 20 clients with overpaid deals:');
  for (const c of sorted.slice(0, 20)) {
    console.log(`  ${c.name}: ${c.count} deals, excess=${c.excess.toLocaleString('ru-RU')}`);
  }

  if (isExecute) {
    console.log(`\nUpdating ${overpaid.length} deals to PAID status...`);

    const dealIds = overpaid.map(d => d.id);

    // Batch update
    const result = await prisma.deal.updateMany({
      where: { id: { in: dealIds } },
      data: { paymentStatus: 'PAID' },
    });

    console.log(`Updated: ${result.count} deals`);

    // Verify
    const remaining = await prisma.deal.count({
      where: {
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        isArchived: false,
      },
    });
    console.log(`Remaining UNPAID/PARTIAL deals: ${remaining}`);

    // Check new total debt on debts page
    const totalResult = await prisma.$queryRaw<{ total: string }[]>(Prisma.sql`
      SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as total
      FROM deals d
      WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
        AND d.status NOT IN ('CANCELED', 'REJECTED')
        AND d.is_archived = false
    `);
    console.log(`\nNew CRM debts page total: ${Number(totalResult[0].total).toLocaleString('ru-RU')} сум`);
  } else {
    console.log('\nThis was a DRY-RUN. To execute, run with --execute flag.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
