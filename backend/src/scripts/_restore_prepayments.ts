/**
 * Restore prepayments for CRM-only clients that were wrongly reduced by sync-payments.
 *
 * The sync incorrectly LIFO-reduced paidAmount on CRM-only clients (not in Excel).
 * This script reverses that by LIFO-increasing paidAmount back by the exact amounts.
 *
 * Run:
 *   cd backend && npx tsx src/scripts/_restore_prepayments.ts            # dry-run
 *   cd backend && npx tsx src/scripts/_restore_prepayments.ts --execute   # live
 */
import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

// These are the CRM-only clients that were reduced, with the exact amounts that were removed
// Source: sync-payments dry-run output
const clientsToRestore: { name: string; amountToRestore: number }[] = [
  { name: 'фужи принт', amountToRestore: 20000 },
  { name: 'эко пак', amountToRestore: 30000 },
  { name: 'кузи ожизлар босмахонаси', amountToRestore: 32000 },
  { name: 'эко стар полиграф', amountToRestore: 33600 },
  { name: 'хумо принт', amountToRestore: 39200 },
  { name: 'глосса', amountToRestore: 40000 },
  { name: 'кафолат мебел', amountToRestore: 50000 },
  { name: 'юнион колор', amountToRestore: 62500 },
  { name: 'хаёт нашр', amountToRestore: 64000 },
  { name: 'дилфуза принт', amountToRestore: 135000 },
  { name: 'селена трейд', amountToRestore: 240000 },
  { name: 'аликсей хан', amountToRestore: 244500 },
  { name: 'васака пак', amountToRestore: 300000 },
  { name: 'пропел груп', amountToRestore: 300000 },
  { name: 'гофур гулом', amountToRestore: 561800 },
  { name: 'моварауннахр', amountToRestore: 772000 },
  { name: 'баркаст полиграф', amountToRestore: 800000 },
  { name: 'лион принт', amountToRestore: 990000 },
  { name: 'анис полиграф', amountToRestore: 1020000 },
  { name: 'СПС', amountToRestore: 2583000 },
  { name: 'ургут колор', amountToRestore: 3300000 },
  { name: 'фото экспрес', amountToRestore: 6100000 },
  { name: 'доссо груп', amountToRestore: 10080000 },
  { name: 'шарк', amountToRestore: 16100000 },
  { name: 'тимур дилшод', amountToRestore: 197784000 },
];

async function main() {
  const isExecute = process.argv.includes('--execute');
  console.log(`=== RESTORE PREPAYMENTS ${isExecute ? '** LIVE **' : '(DRY-RUN)'} ===\n`);

  let totalRestored = 0;
  let clientsProcessed = 0;

  for (const entry of clientsToRestore) {
    const client = await prisma.client.findFirst({
      where: { companyName: { equals: entry.name, mode: 'insensitive' } },
      select: { id: true, companyName: true },
    });

    if (!client) {
      console.log(`  SKIP: ${entry.name} — not found in CRM`);
      continue;
    }

    // Get deals for this client, newest first (LIFO - same order the sync reduced from)
    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, paidAmount: true },
    });

    if (deals.length === 0) {
      console.log(`  SKIP: ${entry.name} — no deals`);
      continue;
    }

    // LIFO add back paidAmount (reverse of the LIFO reduce)
    let remaining = entry.amountToRestore;
    const updates: { dealId: string; newPaid: number; newStatus: string }[] = [];

    for (const deal of deals) {
      if (remaining <= 0.01) break;
      const currentPaid = Number(deal.paidAmount);
      const dealAmount = Number(deal.amount);

      // Add back to paidAmount on this deal
      const canAdd = remaining; // no upper limit needed, overpayment is OK
      const newPaid = Math.round((currentPaid + canAdd) * 100) / 100;

      updates.push({
        dealId: deal.id,
        newPaid,
        newStatus: computePaymentStatus(newPaid, dealAmount),
      });

      remaining -= canAdd;
    }

    const netAfter = deals.reduce((sum, d) => {
      const upd = updates.find(u => u.dealId === d.id);
      const paid = upd ? upd.newPaid : Number(d.paidAmount);
      return sum + (Number(d.amount) - paid);
    }, 0);

    console.log(`  ${client.companyName}: restore ${entry.amountToRestore.toLocaleString('ru-RU')} → net after: ${netAfter.toLocaleString('ru-RU')} (${updates.length} deals)`);

    if (isExecute) {
      await prisma.$transaction(async (tx) => {
        for (const u of updates) {
          await tx.deal.updateMany({
            where: { id: u.dealId },
            data: { paidAmount: u.newPaid, paymentStatus: u.newStatus as any },
          });
        }
      });
    }

    totalRestored += entry.amountToRestore;
    clientsProcessed++;
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Clients processed: ${clientsProcessed}`);
  console.log(`  Total paidAmount restored: ${totalRestored.toLocaleString('ru-RU')}`);

  if (!isExecute) {
    console.log(`\n  This was DRY-RUN. Run with --execute to apply.`);
  }

  // Verify final state
  const result = await prisma.$queryRaw<{ gross: string; net: string }[]>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
      FROM deals d
      WHERE d.is_archived = false
    `
  );
  console.log(`\n  Current CRM gross debt: ${Number(result[0].gross).toLocaleString('ru-RU')}`);
  console.log(`  Current CRM net debt:   ${Number(result[0].net).toLocaleString('ru-RU')}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
