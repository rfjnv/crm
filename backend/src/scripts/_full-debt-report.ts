/**
 * Full Debt Report: every client with exact debt figures.
 * Run: cd backend && npx ts-node src/scripts/_full-debt-report.ts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(80));
  console.log('  FULL DEBT REPORT');
  console.log('  Generated:', new Date().toLocaleString('ru-RU'));
  console.log('='.repeat(80));

  // Query all deals: UNPAID/PARTIAL, not canceled/rejected, not archived
  const deals = await prisma.deal.findMany({
    where: {
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    },
    include: {
      client: { select: { id: true, companyName: true } },
    },
  });

  console.log('\nTotal qualifying deals fetched: ' + deals.length + '\n');

  // Group by client, sum debt per client
  const clientMap = new Map<
    string,
    { name: string; totalDebt: number; dealsCount: number }
  >();

  for (const deal of deals) {
    const cid = deal.clientId;
    const debt = Number(deal.amount) - Number(deal.paidAmount);
    if (!clientMap.has(cid)) {
      clientMap.set(cid, {
        name: deal.client?.companyName || '[unknown id=' + cid + ']',
        totalDebt: 0,
        dealsCount: 0,
      });
    }
    const entry = clientMap.get(cid)!;
    entry.totalDebt += debt;
    entry.dealsCount++;
  }

  // Filter: only clients with positive total debt
  const positiveClients = [...clientMap.values()].filter(
    (c) => c.totalDebt > 0,
  );

  // Sort descending by debt
  positiveClients.sort((a, b) => b.totalDebt - a.totalDebt);

  // Print header
  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);

  console.log('-'.repeat(80));
  console.log(
    pad('#', 5) + ' ' + pad('Client Name', 40) + ' ' + padL('Debt', 18) + ' ' + padL('Deals', 7),
  );
  console.log('-'.repeat(80));

  // Print every client
  let grandTotal = 0;
  let totalDealsCount = 0;

  for (let i = 0; i < positiveClients.length; i++) {
    const c = positiveClients[i];
    grandTotal += c.totalDebt;
    totalDealsCount += c.dealsCount;

    const idx = String(i + 1);
    const name = c.name.length > 38 ? c.name.substring(0, 38) + '..' : c.name;
    const debtStr = c.totalDebt.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const dealsStr = String(c.dealsCount);

    console.log(
      pad(idx, 5) + ' ' + pad(name, 40) + ' ' + padL(debtStr, 18) + ' ' + padL(dealsStr, 7),
    );
  }

  // Summary
  console.log('='.repeat(80));
  console.log(
    pad('', 5) + ' ' + pad('TOTAL', 40) + ' ' + padL(
      grandTotal.toLocaleString('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      18,
    ) + ' ' + padL(String(totalDealsCount), 7),
  );
  console.log('='.repeat(80));

  console.log('\nSummary:');
  console.log('  Clients with positive debt: ' + positiveClients.length);
  console.log('  Total deals (UNPAID/PARTIAL): ' + totalDealsCount);
  console.log(
    '  Grand Total Debt: ' + grandTotal.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );
  console.log('  Grand Total Debt (raw number): ' + grandTotal);

  // Also note clients with zero or negative net debt (overpaid)
  const nonPositive = [...clientMap.values()].filter((c) => c.totalDebt <= 0);
  if (nonPositive.length > 0) {
    console.log(
      '\n  Note: ' + nonPositive.length + ' client(s) excluded (zero or negative net debt):',
    );
    for (const c of nonPositive) {
      console.log(
        '    - ' + c.name + ': ' + c.totalDebt.toLocaleString('ru-RU', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) + ' (' + c.dealsCount + ' deals)',
      );
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
