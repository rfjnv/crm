/**
 * Fix азамат андижон: delete the wrong sync payment and restore deal paidAmount.
 * Then the main sync will handle the correct LIFO-reduce.
 */
import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

async function main() {
  const isExecute = process.argv.includes('--execute');
  console.log(`=== FIX АЗАМАТ АНДИЖОН ${isExecute ? '** LIVE **' : '(DRY-RUN)'} ===\n`);

  const client = await prisma.client.findFirst({
    where: { companyName: { contains: 'азамат андижон', mode: 'insensitive' } },
    select: { id: true, companyName: true },
  });

  if (!client) {
    console.log('Client not found');
    return;
  }

  // Find the wrong sync payment (39,520,000 from the previous run)
  const syncPayments = await prisma.payment.findMany({
    where: {
      clientId: client.id,
      note: { contains: 'Сверка CRM-Excel' },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, dealId: true, createdAt: true },
  });

  console.log(`Found ${syncPayments.length} sync payment(s) for ${client.companyName}:`);
  for (const p of syncPayments) {
    console.log(`  ${p.id}: amount=${Number(p.amount).toLocaleString('ru-RU')}, deal=${p.dealId}, created=${p.createdAt}`);
  }

  // Find the specific wrong payment of 39,520,000 from today's sync
  const paymentsToDelete = syncPayments.filter(p => Number(p.amount) === 39520000);

  console.log(`\nPayments to delete:`);
  let cumulative = 0;
  for (const p of paymentsToDelete) {
    cumulative += Number(p.amount);
    console.log(`  ${p.id}: ${Number(p.amount).toLocaleString('ru-RU')}`);
  }

  // Show current debt
  const debtBefore = await prisma.$queryRaw<{net: string}[]>(
    Prisma.sql`SELECT COALESCE(SUM(amount - paid_amount), 0)::text as net FROM deals WHERE client_id = ${client.id} AND is_archived = false AND status NOT IN ('CANCELED', 'REJECTED')`
  );
  console.log(`\nCurrent active debt: ${Number(debtBefore[0].net).toLocaleString('ru-RU')}`);
  console.log(`After undo should be: ${(Number(debtBefore[0].net) + cumulative).toLocaleString('ru-RU')}`);

  if (isExecute) {
    await prisma.$transaction(async (tx) => {
      for (const p of paymentsToDelete) {
        // Restore deal paidAmount
        const deal = await tx.deal.findUnique({
          where: { id: p.dealId },
          select: { id: true, amount: true, paidAmount: true },
        });
        if (deal) {
          const newPaid = Math.round((Number(deal.paidAmount) - Number(p.amount)) * 100) / 100;
          const newStatus = computePaymentStatus(newPaid, Number(deal.amount));
          await tx.deal.updateMany({
            where: { id: deal.id },
            data: { paidAmount: newPaid, paymentStatus: newStatus as any },
          });
        }
        await tx.payment.delete({ where: { id: p.id } });
      }
    });
    console.log('  Done!');

    const debtAfter = await prisma.$queryRaw<{net: string}[]>(
      Prisma.sql`SELECT COALESCE(SUM(amount - paid_amount), 0)::text as net FROM deals WHERE client_id = ${client.id} AND is_archived = false AND status NOT IN ('CANCELED', 'REJECTED')`
    );
    console.log(`  Active debt after: ${Number(debtAfter[0].net).toLocaleString('ru-RU')}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
