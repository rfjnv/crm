/**
 * FIFO Payment Reallocation Script
 *
 * Redistributes existing payments across deals in FIFO order
 * (oldest deals get paid first). Fixes the debt inflation caused
 * by payments being assigned to wrong deals.
 *
 * Run:
 *   cd backend && npx tsx src/scripts/reallocate-payments.ts            # dry-run
 *   cd backend && npx tsx src/scripts/reallocate-payments.ts --execute   # live
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 30000,
    timeout: 120000,
  },
  datasourceUrl: process.env.DATABASE_URL,
});

interface DealInfo {
  id: string;
  amount: number;
  paidAmount: number;
  createdAt: Date;
  title: string;
}

interface PaymentInfo {
  id: string;
  dealId: string;
  amount: number;
  paidAt: Date;
}

interface ReallocationResult {
  clientId: string;
  clientName: string;
  dealCount: number;
  paymentCount: number;
  totalDealAmount: number;
  totalPayments: number;
  debtBefore: number;    // SUM(MAX(amount - paid, 0))
  debtAfter: number;     // after FIFO reallocation
  paymentMoves: { paymentId: string; fromDealId: string; toDealId: string; amount: number }[];
  dealUpdates: { dealId: string; oldPaid: number; newPaid: number; oldStatus: string; newStatus: string }[];
}

function computeStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

async function processClient(clientId: string, clientName: string): Promise<ReallocationResult | null> {
  // Get all non-archived deals for this client, oldest first
  const deals = await prisma.deal.findMany({
    where: { clientId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, paidAmount: true, paymentStatus: true, createdAt: true, title: true },
  });

  if (deals.length === 0) return null;

  // Get all payments for this client, oldest first
  const payments = await prisma.payment.findMany({
    where: { clientId },
    orderBy: { paidAt: 'asc' },
    select: { id: true, dealId: true, amount: true, paidAt: true },
  });

  if (payments.length === 0) return null;

  const totalDealAmount = deals.reduce((s, d) => s + Number(d.amount), 0);
  const totalPayments = payments.reduce((s, p) => s + Number(p.amount), 0);
  const debtBefore = deals.reduce((s, d) => s + Math.max(Number(d.amount) - Number(d.paidAmount), 0), 0);

  // FIFO allocation: assign payments to deals oldest-first
  const dealSlots = deals.map(d => ({
    id: d.id,
    amount: Number(d.amount),
    oldPaid: Number(d.paidAmount),
    oldStatus: d.paymentStatus,
    newPaid: 0,
    title: d.title,
  }));

  const paymentMoves: ReallocationResult['paymentMoves'] = [];
  let dealIdx = 0;

  for (const payment of payments) {
    let remaining = Number(payment.amount);
    const originalDealId = payment.dealId;

    while (remaining > 0 && dealIdx < dealSlots.length) {
      const deal = dealSlots[dealIdx];
      const capacity = deal.amount - deal.newPaid;

      if (capacity <= 0) {
        dealIdx++;
        continue;
      }

      const allocate = Math.min(remaining, capacity);
      deal.newPaid += allocate;
      remaining -= allocate;

      // If this is the first allocation for this payment, or if we need to split
      if (remaining <= 0) {
        // Full allocation to this deal
        if (originalDealId !== deal.id) {
          paymentMoves.push({
            paymentId: payment.id,
            fromDealId: originalDealId,
            toDealId: deal.id,
            amount: Number(payment.amount),
          });
        }
      }

      if (deal.newPaid >= deal.amount) {
        dealIdx++;
      }

      if (remaining <= 0) break;
    }

    // If there's remaining amount after all deals are filled, put on last deal (overpayment)
    if (remaining > 0) {
      const lastDeal = dealSlots[dealSlots.length - 1];
      lastDeal.newPaid += remaining;

      if (originalDealId !== lastDeal.id) {
        paymentMoves.push({
          paymentId: payment.id,
          fromDealId: originalDealId,
          toDealId: lastDeal.id,
          amount: Number(payment.amount),
        });
      }
    }
  }

  // Compute deal updates
  const dealUpdates: ReallocationResult['dealUpdates'] = [];
  for (const ds of dealSlots) {
    const newStatus = computeStatus(ds.newPaid, ds.amount);
    if (Math.abs(ds.oldPaid - ds.newPaid) > 0.01 || ds.oldStatus !== newStatus) {
      dealUpdates.push({
        dealId: ds.id,
        oldPaid: ds.oldPaid,
        newPaid: ds.newPaid,
        oldStatus: ds.oldStatus,
        newStatus,
      });
    }
  }

  const debtAfter = dealSlots.reduce((s, d) => s + Math.max(d.amount - d.newPaid, 0), 0);

  // Only return if there are actual changes
  if (paymentMoves.length === 0 && dealUpdates.length === 0) return null;

  return {
    clientId,
    clientName,
    dealCount: deals.length,
    paymentCount: payments.length,
    totalDealAmount,
    totalPayments,
    debtBefore,
    debtAfter,
    paymentMoves,
    dealUpdates,
  };
}

async function executeReallocation(results: ReallocationResult[]): Promise<void> {
  let clientsDone = 0;
  let totalMoves = 0;
  let totalDealUpdates = 0;
  let errors = 0;

  for (const r of results) {
    // Retry up to 3 times for transient errors
    let success = false;
    for (let attempt = 1; attempt <= 3 && !success; attempt++) {
      try {
        // Use non-interactive transaction with batched operations for better performance
        const ops: any[] = [];

        // Move payments to new deals
        for (const move of r.paymentMoves) {
          ops.push(
            prisma.payment.update({
              where: { id: move.paymentId },
              data: { dealId: move.toDealId },
            })
          );
        }

        // Update deal paidAmount and paymentStatus
        for (const du of r.dealUpdates) {
          ops.push(
            prisma.deal.updateMany({
              where: { id: du.dealId },
              data: {
                paidAmount: du.newPaid,
                paymentStatus: du.newStatus as any,
              },
            })
          );
        }

        // Execute all operations in a single batch transaction
        await prisma.$transaction(ops, { timeout: 120000 });

        totalMoves += r.paymentMoves.length;
        totalDealUpdates += r.dealUpdates.length;
        clientsDone++;
        success = true;

        if (clientsDone % 20 === 0) {
          console.log(`  ... executed ${clientsDone}/${results.length} clients`);
        }

        // Small delay to avoid overwhelming remote DB
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        if (attempt < 3) {
          console.log(`  RETRY ${attempt}/3: ${r.clientName}`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        } else {
          console.error(`  ERROR: ${r.clientName}: ${(err as Error).message.slice(0, 200)}`);
          errors++;
        }
      }
    }
  }

  console.log(`\n  EXECUTION COMPLETE:`);
  console.log(`    Clients updated: ${clientsDone}`);
  console.log(`    Clients failed: ${errors}`);
  console.log(`    Payments moved: ${totalMoves}`);
  console.log(`    Deals updated: ${totalDealUpdates}`);
}

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(60));
  console.log(`  FIFO PAYMENT REALLOCATION ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(60));

  // Get current debt
  const currentDebtResult = await prisma.$queryRaw<{ debt: string; net: string }[]>(
    Prisma.sql`SELECT
      SUM(GREATEST(amount - paid_amount, 0))::text as debt,
      SUM(amount - paid_amount)::text as net
    FROM deals WHERE is_archived = false`
  );
  const currentDebt = Number(currentDebtResult[0].debt);
  const currentNet = Number(currentDebtResult[0].net);
  console.log(`\nCurrent CRM debt (GREATEST): ${currentDebt.toLocaleString()}`);
  console.log(`Current CRM net debt: ${currentNet.toLocaleString()}`);

  // Get all clients with deals
  const clients = await prisma.client.findMany({
    where: {
      deals: { some: { isArchived: false } },
    },
    select: { id: true, companyName: true },
  });
  console.log(`\nProcessing ${clients.length} clients...\n`);

  const results: ReallocationResult[] = [];
  let processed = 0;
  let executedCount = 0;
  let errorCount = 0;

  // Process and optionally execute per-client (avoids holding all data in memory)
  for (const client of clients) {
    const result = await processClient(client.id, client.companyName);
    processed++;

    if (result) {
      results.push(result);

      // Execute immediately per client (if in execute mode)
      if (isExecute && (result.paymentMoves.length > 0 || result.dealUpdates.length > 0)) {
        let success = false;
        for (let attempt = 1; attempt <= 3 && !success; attempt++) {
          try {
            const ops: any[] = [];
            for (const move of result.paymentMoves) {
              ops.push(prisma.payment.update({
                where: { id: move.paymentId },
                data: { dealId: move.toDealId },
              }));
            }
            for (const du of result.dealUpdates) {
              ops.push(prisma.deal.updateMany({
                where: { id: du.dealId },
                data: { paidAmount: du.newPaid, paymentStatus: du.newStatus as any },
              }));
            }
            await prisma.$transaction(ops, { timeout: 120000 });
            executedCount++;
            success = true;
          } catch (err) {
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
            } else {
              console.error(`  ERROR: ${result.clientName}: ${(err as Error).message.slice(0, 150)}`);
              errorCount++;
            }
          }
        }
      }
    }

    if (processed % 50 === 0) {
      console.log(`  ... processed ${processed}/${clients.length}${isExecute ? ` (executed: ${executedCount}, errors: ${errorCount})` : ''}`);
    }

    // Delay to prevent connection pool exhaustion on remote DB
    if (processed % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Sort by debt reduction (biggest impact first) for report
  results.sort((a, b) => (b.debtBefore - b.debtAfter) - (a.debtBefore - a.debtAfter));

  // Report
  console.log('\n' + '='.repeat(60));
  console.log('  REALLOCATION REPORT');
  console.log('='.repeat(60));

  let totalDebtBefore = 0;
  let totalDebtAfter = 0;
  let totalMoves = 0;
  let totalDealUpdates = 0;

  console.log(`\n${'Client'.padEnd(35)} | ${'Debt Before'.padStart(14)} | ${'Debt After'.padStart(14)} | ${'Reduction'.padStart(14)} | ${'Moves'.padStart(6)}`);
  console.log('-'.repeat(95));

  for (const r of results) {
    totalDebtBefore += r.debtBefore;
    totalDebtAfter += r.debtAfter;
    totalMoves += r.paymentMoves.length;
    totalDealUpdates += r.dealUpdates.length;

    const reduction = r.debtBefore - r.debtAfter;
    if (reduction > 0) {
      console.log(
        `${r.clientName.substring(0, 35).padEnd(35)} | ` +
        `${r.debtBefore.toLocaleString().padStart(14)} | ` +
        `${r.debtAfter.toLocaleString().padStart(14)} | ` +
        `${reduction.toLocaleString().padStart(14)} | ` +
        `${String(r.paymentMoves.length).padStart(6)}`
      );
    }
  }

  const unchangedClients = clients.length - results.length;

  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total clients: ${clients.length}`);
  console.log(`  Clients with changes: ${results.length}`);
  console.log(`  Clients unchanged: ${unchangedClients}`);
  console.log(`  Payment moves needed: ${totalMoves}`);
  console.log(`  Deal updates needed: ${totalDealUpdates}`);
  console.log(`  Debt before reallocation: ${totalDebtBefore.toLocaleString()}`);
  console.log(`  Debt after reallocation: ${totalDebtAfter.toLocaleString()}`);
  console.log(`  Debt reduction: ${(totalDebtBefore - totalDebtAfter).toLocaleString()}`);
  console.log(`  Total CRM debt after: ${(currentDebt - (totalDebtBefore - totalDebtAfter)).toLocaleString()}`);

  if (isExecute) {
    console.log(`\n  EXECUTED: ${executedCount} clients updated, ${errorCount} errors`);
  } else {
    console.log('\n  This was a DRY-RUN. To execute, run with --execute flag.');
  }
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
