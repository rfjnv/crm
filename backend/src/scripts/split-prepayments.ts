/**
 * Split mixed debt+prepayment clients into separate deals.
 *
 * For 9 clients that have both debt rows (к,п/к,н/к,ф) and
 * non-debt rows (пп, н) in Excel, CRM nets them into one client total.
 * This script creates tagged "ПП:" deals so the debts page
 * can compute gross/prepay matching Excel exactly.
 *
 * Run:
 *   npx tsx src/scripts/split-prepayments.ts            # dry-run
 *   npx tsx src/scripts/split-prepayments.ts --execute   # live
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

interface Adjustment {
  clientName: string;
  ppAmount: number;
  type: 'pp' | 'cash' | 'rename';
  label: string;
}

// pp:     client has пп rows in Excel → create ПП deal with negative debt
// cash:   client has н row in Excel → create ПП deal with positive debt
// rename: just tag existing deal as ПП
const ADJUSTMENTS: Adjustment[] = [
  { clientName: 'евро принт',            ppAmount: 1354000,  type: 'pp',     label: 'предоплата (пп)' },
  { clientName: 'академ нашр',            ppAmount: 1120000,  type: 'pp',     label: 'предоплата (пп)' },
  { clientName: 'иннавацион тех принт',   ppAmount: 857100,   type: 'pp',     label: 'предоплата (пп)' },
  { clientName: 'принт теч',              ppAmount: 520000,   type: 'pp',     label: 'предоплата (пп)' },
  { clientName: 'эксилинт принт',         ppAmount: 452800,   type: 'pp',     label: 'предоплата (пп)' },
  { clientName: 'журабек принт',          ppAmount: 129000,   type: 'pp',     label: 'предоплата (пп)' },
  { clientName: 'картография',            ppAmount: 100000,   type: 'pp',     label: 'предоплата (пп)' },
  { clientName: 'ламинация цех',          ppAmount: 2566900,  type: 'cash',   label: 'наличные (н)' },
  { clientName: 'вм принт',              ppAmount: 784000,   type: 'rename', label: 'предоплата (пп)' },
];

function paymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU');
}

async function main() {
  console.log(`=== Split prepayments (${EXECUTE ? 'LIVE' : 'DRY-RUN'}) ===\n`);

  const existingPP = await prisma.deal.count({
    where: { title: { startsWith: 'ПП:' }, isArchived: false },
  });
  if (existingPP > 0 && EXECUTE) {
    console.log(`ABORT: Found ${existingPP} existing "ПП:" deals. Delete them first to re-run.`);
    return;
  }

  for (const adj of ADJUSTMENTS) {
    console.log(`--- ${adj.clientName} (${adj.type}, ${fmt(adj.ppAmount)}) ---`);

    const client = await prisma.client.findFirst({
      where: { companyName: { contains: adj.clientName, mode: 'insensitive' } },
    });
    if (!client) { console.log('  ERROR: Client not found!\n'); continue; }

    const debtRes = await prisma.$queryRaw<{ debt: string }[]>(
      Prisma.sql`SELECT COALESCE(SUM(amount - paid_amount), 0)::text as debt
       FROM deals WHERE client_id = ${client.id}
         AND is_archived = false AND status NOT IN ('CANCELED', 'REJECTED')`
    );
    console.log(`  Client: ${client.companyName}`);
    console.log(`  Current debt: ${fmt(Number(debtRes[0].debt))}`);

    const sampleDeal = await prisma.deal.findFirst({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
      orderBy: { createdAt: 'desc' },
      select: { managerId: true },
    });
    if (!sampleDeal) { console.log('  ERROR: No deals!\n'); continue; }

    if (adj.type === 'rename') {
      const deal = await prisma.deal.findFirst({
        where: {
          clientId: client.id, isArchived: false,
          status: { notIn: ['CANCELED', 'REJECTED'] },
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!deal) { console.log('  ERROR: No unpaid deal!\n'); continue; }

      console.log(`  Rename "${deal.title}" → "ПП: ${adj.clientName} ${adj.label}"`);
      if (EXECUTE) {
        await prisma.deal.update({
          where: { id: deal.id },
          data: { title: `ПП: ${adj.clientName} ${adj.label}` },
        });
        console.log('  DONE');
      }
    } else if (adj.type === 'pp') {
      // Find biggest deal to absorb decreased paidAmount
      const deal = await prisma.deal.findFirst({
        where: {
          clientId: client.id, isArchived: false,
          status: { notIn: ['CANCELED', 'REJECTED'] },
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        orderBy: [{ amount: 'desc' }],
      });
      if (!deal) { console.log('  ERROR: No suitable deal!\n'); continue; }

      const oldPaid = Number(deal.paidAmount);
      const newPaid = oldPaid - adj.ppAmount;
      const newSt = paymentStatus(newPaid, Number(deal.amount));

      console.log(`  Deal "${deal.title}": paid ${fmt(oldPaid)} → ${fmt(newPaid)} (${newSt})`);
      console.log(`  New ПП deal: amount=0, paid=${fmt(adj.ppAmount)} → debt=${fmt(-adj.ppAmount)}`);

      if (EXECUTE) {
        await prisma.$transaction([
          prisma.deal.update({
            where: { id: deal.id },
            data: { paidAmount: newPaid, paymentStatus: newSt as any },
          }),
          prisma.deal.create({
            data: {
              title: `ПП: ${adj.clientName} ${adj.label}`,
              amount: 0, paidAmount: adj.ppAmount,
              paymentStatus: 'PAID', status: 'CLOSED',
              clientId: client.id, managerId: sampleDeal.managerId,
              isArchived: false,
            },
          }),
        ]);
        console.log('  DONE');
      }
    } else if (adj.type === 'cash') {
      const deal = await prisma.deal.findFirst({
        where: {
          clientId: client.id, isArchived: false,
          status: { notIn: ['CANCELED', 'REJECTED'] },
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        orderBy: [{ amount: 'desc' }],
      });
      if (!deal) { console.log('  ERROR: No suitable deal!\n'); continue; }

      const oldPaid = Number(deal.paidAmount);
      const newPaid = oldPaid + adj.ppAmount;
      const newSt = paymentStatus(newPaid, Number(deal.amount));

      console.log(`  Deal "${deal.title}": paid ${fmt(oldPaid)} → ${fmt(newPaid)} (${newSt})`);
      console.log(`  New ПП deal: amount=${fmt(adj.ppAmount)}, paid=0 → debt=+${fmt(adj.ppAmount)}`);

      if (EXECUTE) {
        await prisma.$transaction([
          prisma.deal.update({
            where: { id: deal.id },
            data: { paidAmount: newPaid, paymentStatus: newSt as any },
          }),
          prisma.deal.create({
            data: {
              title: `ПП: ${adj.clientName} ${adj.label}`,
              amount: adj.ppAmount, paidAmount: 0,
              paymentStatus: 'UNPAID', status: 'NEW',
              clientId: client.id, managerId: sampleDeal.managerId,
              isArchived: false,
            },
          }),
        ]);
        console.log('  DONE');
      }
    }
    console.log();
  }

  if (!EXECUTE) console.log('Re-run with --execute to apply.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
