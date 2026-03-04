/**
 * Detect duplicate clients in the CRM database.
 *
 * Clients whose names produce the same normalized key (lowercase,
 * trimmed, token-sorted) are flagged as duplicates.
 *
 * This script is READ-ONLY — it never mutates data.
 *
 * Run:
 *   cd backend && npx tsx src/scripts/detect-duplicate-clients.ts
 *   cd backend && npx tsx src/scripts/detect-duplicate-clients.ts --csv   # also write CSV
 */

import * as fs from 'fs';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

interface ClientRow {
  id: string;
  companyName: string;
  managerId: string;
  managerName: string;
  isArchived: boolean;
  createdAt: Date;
}

interface DuplicateGroup {
  normalizedName: string;
  clients: {
    clientId: string;
    clientName: string;
    managerName: string;
    isArchived: boolean;
    createdAt: Date;
    dealsCount: number;
    totalDebt: number;
    totalPaid: number;
    paymentsCount: number;
  }[];
}

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

async function main() {
  console.log('='.repeat(80));
  console.log('  DUPLICATE CLIENT DETECTION (READ-ONLY)');
  console.log('='.repeat(80));
  console.log('  This script does NOT modify any data.\n');

  // ── Step 1: Load all clients ──
  console.log('[1/3] Loading all clients...');
  const allClients = await prisma.client.findMany({
    select: {
      id: true,
      companyName: true,
      managerId: true,
      isArchived: true,
      createdAt: true,
      manager: { select: { fullName: true } },
    },
  });
  console.log(`  Total clients in DB: ${allClients.length}`);

  // ── Step 2: Group by normalized name ──
  console.log('\n[2/3] Grouping by normalized name...');
  const groups = new Map<string, ClientRow[]>();

  for (const c of allClients) {
    const normKey = normalizeClientName(c.companyName);
    if (!normKey) continue;

    if (!groups.has(normKey)) {
      groups.set(normKey, []);
    }
    groups.get(normKey)!.push({
      id: c.id,
      companyName: c.companyName,
      managerId: c.managerId,
      managerName: c.manager.fullName,
      isArchived: c.isArchived,
      createdAt: c.createdAt,
    });
  }

  // Find groups with more than one client
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [normName, clients] of groups) {
    if (clients.length < 2) continue;

    // Load deal/payment stats for each client in the group
    const groupData: DuplicateGroup = {
      normalizedName: normName,
      clients: [],
    };

    for (const client of clients) {
      // Count deals and compute debt
      const dealStats = await prisma.deal.aggregate({
        where: { clientId: client.id, isArchived: false },
        _count: { id: true },
        _sum: { amount: true, paidAmount: true },
      });

      const dealsCount = dealStats._count.id;
      const totalAmount = Number(dealStats._sum.amount || 0);
      const totalPaid = Number(dealStats._sum.paidAmount || 0);
      const totalDebt = Math.max(totalAmount - totalPaid, 0);

      // Count payments
      const paymentsCount = await prisma.payment.count({
        where: { clientId: client.id },
      });

      groupData.clients.push({
        clientId: client.id,
        clientName: client.companyName,
        managerName: client.managerName,
        isArchived: client.isArchived,
        createdAt: client.createdAt,
        dealsCount,
        totalDebt,
        totalPaid,
        paymentsCount,
      });
    }

    // Sort within group: most deals first (primary client candidate)
    groupData.clients.sort((a, b) => b.dealsCount - a.dealsCount || a.createdAt.getTime() - b.createdAt.getTime());

    duplicateGroups.push(groupData);
  }

  // Sort groups: most total deals first
  duplicateGroups.sort((a, b) => {
    const aTotalDeals = a.clients.reduce((s, c) => s + c.dealsCount, 0);
    const bTotalDeals = b.clients.reduce((s, c) => s + c.dealsCount, 0);
    return bTotalDeals - aTotalDeals;
  });

  // ── Step 3: Report ──
  console.log('\n[3/3] Generating report...\n');

  if (duplicateGroups.length === 0) {
    console.log('  No duplicate clients found. All names are unique after normalization.');
    await prisma.$disconnect();
    return;
  }

  console.log('='.repeat(100));
  console.log(`  DUPLICATE CLIENT GROUPS: ${duplicateGroups.length} groups found`);
  console.log('='.repeat(100));

  let totalDuplicateClients = 0;

  for (let i = 0; i < duplicateGroups.length; i++) {
    const group = duplicateGroups[i];
    totalDuplicateClients += group.clients.length;

    console.log(`\n--- Group ${i + 1}: "${group.normalizedName}" (${group.clients.length} clients) ---`);
    console.log(
      `  ${'Client ID'.padEnd(38)} | ` +
      `${'Original Name'.padEnd(30)} | ` +
      `${'Manager'.padEnd(15)} | ` +
      `${'Deals'.padStart(5)} | ` +
      `${'Debt'.padStart(16)} | ` +
      `${'Paid'.padStart(16)} | ` +
      `${'Pmts'.padStart(5)} | ` +
      `${'Archived'.padStart(8)}`
    );
    console.log('  ' + '-'.repeat(148));

    for (const c of group.clients) {
      console.log(
        `  ${c.clientId.padEnd(38)} | ` +
        `${c.clientName.substring(0, 30).padEnd(30)} | ` +
        `${c.managerName.substring(0, 15).padEnd(15)} | ` +
        `${String(c.dealsCount).padStart(5)} | ` +
        `${fmtNum(c.totalDebt).padStart(16)} | ` +
        `${fmtNum(c.totalPaid).padStart(16)} | ` +
        `${String(c.paymentsCount).padStart(5)} | ` +
        `${(c.isArchived ? 'YES' : 'no').padStart(8)}`
      );
    }

    // Suggested merge
    const primary = group.clients[0];
    const secondaries = group.clients.slice(1);
    console.log(`\n  SUGGESTED MERGE:`);
    console.log(`    Keep:   "${primary.clientName}" (${primary.clientId}) — ${primary.dealsCount} deals, debt ${fmtNum(primary.totalDebt)}`);
    for (const sec of secondaries) {
      console.log(`    Merge:  "${sec.clientName}" (${sec.clientId}) — ${sec.dealsCount} deals, debt ${fmtNum(sec.totalDebt)}`);
      console.log(`            → Move ${sec.dealsCount} deals, ${sec.paymentsCount} payments to primary client`);
    }
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Total duplicate groups:   ${duplicateGroups.length}`);
  console.log(`  Total duplicate clients:  ${totalDuplicateClients}`);
  console.log(`  Clients that would be merged away: ${totalDuplicateClients - duplicateGroups.length}`);
  console.log(`\n  NO DATA WAS MODIFIED. This is a read-only report.`);
  console.log(`  To merge duplicates, run: npx tsx src/scripts/merge-duplicate-clients.ts`);

  // ── Optional CSV export ──
  if (process.argv.includes('--csv')) {
    const csvLines = [
      'group_num,normalized_name,client_id,client_name,manager,deals_count,total_debt,total_paid,payments_count,is_archived,suggested_action',
    ];

    for (let i = 0; i < duplicateGroups.length; i++) {
      const group = duplicateGroups[i];
      for (let j = 0; j < group.clients.length; j++) {
        const c = group.clients[j];
        const action = j === 0 ? 'KEEP (primary)' : 'MERGE into primary';
        csvLines.push(
          `${i + 1},"${group.normalizedName}","${c.clientId}","${c.clientName.replace(/"/g, '""')}","${c.managerName.replace(/"/g, '""')}",${c.dealsCount},${c.totalDebt},${c.totalPaid},${c.paymentsCount},${c.isArchived},"${action}"`
        );
      }
    }

    const csvPath = path.resolve(process.cwd(), '..', `duplicate-clients-report-${Date.now()}.csv`);
    fs.writeFileSync(csvPath, '\uFEFF' + csvLines.join('\n'), 'utf8');
    console.log(`\n  CSV report saved: ${csvPath}`);
  }
}

main()
  .catch((err) => {
    console.error('Detection failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
