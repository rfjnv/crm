/**
 * Undo the sync-payments changes that were incorrect:
 * 1. Delete the ламинация цех payment and restore deal paidAmount
 * 2. Restore paidAmount on 7 Excel-matched clients that were over-reduced
 *
 * Run:
 *   cd backend && npx tsx src/scripts/_undo_sync.ts            # dry-run
 *   cd backend && npx tsx src/scripts/_undo_sync.ts --execute   # live
 */
import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

// Clients that were LIFO-reduced by sync (Excel-matched, not CRM-only)
// These need paidAmount INCREASED back
const reducedClients: { name: string; amountToRestore: number }[] = [
  { name: 'картография', amountToRestore: 100000 },
  { name: 'журабек принт', amountToRestore: 129000 },
  { name: 'эксилинт принт', amountToRestore: 452800 },
  { name: 'принт теч', amountToRestore: 520000 },
  { name: 'иннавацион тех принт', amountToRestore: 857100 },
  { name: 'академ нашр', amountToRestore: 1120000 },
  { name: 'евро принт', amountToRestore: 1354000 },
];

async function main() {
  const isExecute = process.argv.includes('--execute');
  console.log(`=== UNDO SYNC CHANGES ${isExecute ? '** LIVE **' : '(DRY-RUN)'} ===\n`);

  // === 1. Undo ламинация цех payment ===
  console.log('--- 1. Undo ламинация цех payment ---');
  const lamClient = await prisma.client.findFirst({
    where: { companyName: { contains: 'ламинация цех', mode: 'insensitive' } },
    select: { id: true, companyName: true },
  });

  if (lamClient) {
    // Find ONLY the most recent sync payment (amount=2,566,900 from today's run)
    const syncPayments = await prisma.payment.findMany({
      where: {
        clientId: lamClient.id,
        note: { contains: 'Сверка CRM-Excel: Март 2026' },
        amount: { equals: 2566900 },
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { id: true, amount: true, dealId: true, createdAt: true },
    });

    console.log(`  Found ${syncPayments.length} sync payment(s) for ${lamClient.companyName}`);
    let totalPayment = 0;
    for (const p of syncPayments) {
      console.log(`    Payment ${p.id}: amount=${Number(p.amount).toLocaleString('ru-RU')}, deal=${p.dealId}`);
      totalPayment += Number(p.amount);
    }

    if (isExecute && syncPayments.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const p of syncPayments) {
          // Get current deal state
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
            console.log(`    Updated deal ${deal.id}: paidAmount ${Number(deal.paidAmount)} -> ${newPaid}`);
          }
          // Delete payment
          await tx.payment.delete({ where: { id: p.id } });
          console.log(`    Deleted payment ${p.id}`);
        }
      });
    }

    // Verify
    const lamDebt = await prisma.$queryRaw<{net: string}[]>(
      Prisma.sql`SELECT COALESCE(SUM(amount - paid_amount), 0)::text as net FROM deals WHERE client_id = ${lamClient.id} AND is_archived = false`
    );
    console.log(`  ${lamClient.companyName} net debt: ${Number(lamDebt[0].net).toLocaleString('ru-RU')}`);
  }

  // === 2. Restore 7 reduced clients ===
  console.log('\n--- 2. Restore over-reduced clients ---');
  for (const entry of reducedClients) {
    const client = await prisma.client.findFirst({
      where: { companyName: { equals: entry.name, mode: 'insensitive' } },
      select: { id: true, companyName: true },
    });

    if (!client) {
      console.log(`  SKIP: ${entry.name} — not found`);
      continue;
    }

    // Get deals, newest first (LIFO order matching the original reduce)
    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, paidAmount: true },
    });

    let remaining = entry.amountToRestore;
    const updates: { dealId: string; oldPaid: number; newPaid: number; amount: number }[] = [];

    for (const deal of deals) {
      if (remaining <= 0.01) break;
      const currentPaid = Number(deal.paidAmount);
      const dealAmount = Number(deal.amount);
      const newPaid = Math.round((currentPaid + remaining) * 100) / 100;

      updates.push({
        dealId: deal.id,
        oldPaid: currentPaid,
        newPaid,
        amount: dealAmount,
      });
      remaining = 0; // put it all on the first deal
    }

    if (isExecute) {
      await prisma.$transaction(async (tx) => {
        for (const u of updates) {
          const newStatus = computePaymentStatus(u.newPaid, u.amount);
          await tx.deal.updateMany({
            where: { id: u.dealId },
            data: { paidAmount: u.newPaid, paymentStatus: newStatus as any },
          });
        }
      });
    }

    const netResult = await prisma.$queryRaw<{net: string}[]>(
      Prisma.sql`SELECT COALESCE(SUM(amount - paid_amount), 0)::text as net FROM deals WHERE client_id = ${client.id} AND is_archived = false`
    );
    const currentNet = Number(netResult[0].net);
    const expectedNet = currentNet - (isExecute ? 0 : entry.amountToRestore);
    console.log(`  ${client.companyName}: restore ${entry.amountToRestore.toLocaleString('ru-RU')} → net after: ${(isExecute ? currentNet : expectedNet).toLocaleString('ru-RU')}`);
  }

  // === Summary ===
  const totals = await prisma.$queryRaw<{ gross: string; net: string }[]>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
      FROM deals d WHERE d.is_archived = false
    `
  );
  console.log(`\n=== CURRENT STATE ===`);
  console.log(`  Gross debt: ${Number(totals[0].gross).toLocaleString('ru-RU')}`);
  console.log(`  Net debt:   ${Number(totals[0].net).toLocaleString('ru-RU')}`);

  if (!isExecute) {
    console.log('\n  DRY-RUN. Run with --execute to apply.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
