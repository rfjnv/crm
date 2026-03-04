/**
 * Merge duplicate clients in the CRM database.
 *
 * For each set of duplicate clients (same normalized name):
 *   - Keeps the "primary" client (most deals, oldest created)
 *   - Moves all deals, payments, and contracts from secondary clients to primary
 *   - Archives secondary clients (does NOT delete them)
 *
 * Run:
 *   cd backend && npx tsx src/scripts/merge-duplicate-clients.ts             # dry-run
 *   cd backend && npx tsx src/scripts/merge-duplicate-clients.ts --execute   # live merge
 */

import { PrismaClient } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

interface MergeAction {
  primaryId: string;
  primaryName: string;
  secondaryId: string;
  secondaryName: string;
  dealsToMove: number;
  paymentsToMove: number;
  contractsToMove: number;
}

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(80));
  console.log(`  DUPLICATE CLIENT MERGE  ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(80));

  // ── Load all clients ──
  const allClients = await prisma.client.findMany({
    select: {
      id: true,
      companyName: true,
      isArchived: true,
      createdAt: true,
    },
  });

  // ── Group by normalized name ──
  const groups = new Map<string, typeof allClients>();
  for (const c of allClients) {
    const key = normalizeClientName(c.companyName);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  // ── Find duplicate groups ──
  const mergeActions: MergeAction[] = [];

  for (const [, clients] of groups) {
    if (clients.length < 2) continue;

    // Determine primary: prefer non-archived, then most deals, then oldest
    const withCounts = await Promise.all(
      clients.map(async (c) => {
        const dealsCount = await prisma.deal.count({ where: { clientId: c.id } });
        return { ...c, dealsCount };
      })
    );

    withCounts.sort((a, b) => {
      // Non-archived first
      if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
      // Most deals first
      if (b.dealsCount !== a.dealsCount) return b.dealsCount - a.dealsCount;
      // Oldest first
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const primary = withCounts[0];
    const secondaries = withCounts.slice(1);

    for (const sec of secondaries) {
      const dealsToMove = await prisma.deal.count({ where: { clientId: sec.id } });
      const paymentsToMove = await prisma.payment.count({ where: { clientId: sec.id } });
      const contractsToMove = await prisma.contract.count({ where: { clientId: sec.id } });

      mergeActions.push({
        primaryId: primary.id,
        primaryName: primary.companyName,
        secondaryId: sec.id,
        secondaryName: sec.companyName,
        dealsToMove,
        paymentsToMove,
        contractsToMove,
      });
    }
  }

  if (mergeActions.length === 0) {
    console.log('\n  No duplicate clients found. Nothing to merge.');
    await prisma.$disconnect();
    return;
  }

  // ── Report ──
  console.log(`\n  Merge actions planned: ${mergeActions.length}\n`);
  console.log(
    `  ${'Secondary Client'.padEnd(30)} | ` +
    `${'Primary Client'.padEnd(30)} | ` +
    `${'Deals'.padStart(5)} | ` +
    `${'Pmts'.padStart(5)} | ` +
    `${'Contracts'.padStart(9)}`
  );
  console.log('  ' + '-'.repeat(90));

  for (const action of mergeActions) {
    console.log(
      `  ${action.secondaryName.substring(0, 30).padEnd(30)} | ` +
      `${action.primaryName.substring(0, 30).padEnd(30)} | ` +
      `${String(action.dealsToMove).padStart(5)} | ` +
      `${String(action.paymentsToMove).padStart(5)} | ` +
      `${String(action.contractsToMove).padStart(9)}`
    );
  }

  const totalDeals = mergeActions.reduce((s, a) => s + a.dealsToMove, 0);
  const totalPayments = mergeActions.reduce((s, a) => s + a.paymentsToMove, 0);
  const totalContracts = mergeActions.reduce((s, a) => s + a.contractsToMove, 0);

  console.log(`\n  Total: ${mergeActions.length} clients to merge, ${totalDeals} deals, ${totalPayments} payments, ${totalContracts} contracts to reassign`);

  // ── Execute ──
  if (!isExecute) {
    console.log('\n  This was a DRY-RUN. To execute, run with --execute flag.');
    await prisma.$disconnect();
    return;
  }

  console.log('\n  EXECUTING MERGE...');
  let done = 0;
  let errors = 0;

  for (const action of mergeActions) {
    try {
      await prisma.$transaction(async (tx) => {
        // Move deals
        if (action.dealsToMove > 0) {
          await tx.deal.updateMany({
            where: { clientId: action.secondaryId },
            data: { clientId: action.primaryId },
          });
        }

        // Move payments
        if (action.paymentsToMove > 0) {
          await tx.payment.updateMany({
            where: { clientId: action.secondaryId },
            data: { clientId: action.primaryId },
          });
        }

        // Move contracts
        if (action.contractsToMove > 0) {
          await tx.contract.updateMany({
            where: { clientId: action.secondaryId },
            data: { clientId: action.primaryId },
          });
        }

        // Archive the secondary client (don't delete)
        await tx.client.update({
          where: { id: action.secondaryId },
          data: { isArchived: true },
        });
      });

      done++;
      console.log(`  [${done}/${mergeActions.length}] Merged "${action.secondaryName}" → "${action.primaryName}"`);
    } catch (err) {
      errors++;
      console.error(`  ERROR merging "${action.secondaryName}": ${(err as Error).message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`  MERGE COMPLETE: ${done} merged, ${errors} errors`);
  console.log('='.repeat(80));
}

main()
  .catch((err) => {
    console.error('Merge failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
