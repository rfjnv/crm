import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Per-client debt from closingBalance (new method)
  const perClientDebt = await prisma.$queryRaw<{ client_id: string; total_debt: string }[]>`
    SELECT d.client_id,
      COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F','PP')
          THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS total_debt
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
      AND di.closing_balance IS NOT NULL
    GROUP BY d.client_id
  `;

  const cbMap = new Map<string, number>();
  for (const r of perClientDebt) cbMap.set(r.client_id, Number(r.total_debt));

  // 2. Old method: deal.amount - deal.paidAmount
  const oldAgg = await prisma.deal.groupBy({
    by: ['clientId'],
    where: { isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
    _sum: { amount: true, paidAmount: true },
  });
  const oldMap = new Map<string, number>();
  for (const r of oldAgg) {
    oldMap.set(r.clientId, Number(r._sum.amount ?? 0) - Number(r._sum.paidAmount ?? 0));
  }

  // 3. Get client names
  const allClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const nameMap = new Map<string, string>();
  for (const c of allClients) nameMap.set(c.id, c.companyName);

  // Check specific clients
  const checkClients = ['е гранд', 'ламинация цех', 'кампютер мужизаси', 'азамат андижон', 'мега папер'];

  console.log('=== Per-client debt comparison ===\n');
  console.log('Client'.padEnd(30), 'Old (amount-paid)'.padStart(18), 'New (closingBal)'.padStart(18), 'Match?');
  console.log('-'.repeat(90));

  for (const name of checkClients) {
    const client = allClients.find(c => c.companyName.toLowerCase().includes(name));
    if (!client) { console.log(`  "${name}" not found`); continue; }

    const old = oldMap.get(client.id) ?? 0;
    const cb = cbMap.get(client.id) ?? 0;

    console.log(
      client.companyName.padEnd(30),
      Math.round(old).toLocaleString('ru-RU').padStart(18),
      Math.round(cb).toLocaleString('ru-RU').padStart(18),
      old === cb ? '  OK' : '  ✗ DIFFERENT'
    );
  }

  // Top 20 debtors
  const sorted = [...cbMap.entries()]
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\n=== Top 20 debtors (closingBalance) ===\n');
  console.log('Client'.padEnd(30), 'closingBal'.padStart(15), 'old debt'.padStart(15));
  console.log('-'.repeat(65));
  for (const [id, debt] of sorted) {
    const name = nameMap.get(id) || 'Unknown';
    const old = oldMap.get(id) ?? 0;
    console.log(
      name.padEnd(30),
      Math.round(debt).toLocaleString('ru-RU').padStart(15),
      Math.round(old).toLocaleString('ru-RU').padStart(15)
    );
  }

  // Clients with debt but no UNPAID deals (would be missing from old logic)
  const unpaidDeals = await prisma.deal.findMany({
    where: { isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] }, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
    select: { clientId: true },
  });
  const hasUnpaidDeal = new Set(unpaidDeals.map(d => d.clientId));

  const missingClients = [...cbMap.entries()].filter(([id, debt]) => debt > 0 && !hasUnpaidDeal.has(id));
  if (missingClients.length > 0) {
    console.log(`\n=== ${missingClients.length} clients with closingBalance debt but NO UNPAID/PARTIAL deals ===`);
    for (const [id, debt] of missingClients.sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${(nameMap.get(id) || 'Unknown').padEnd(30)} debt: ${Math.round(debt).toLocaleString('ru-RU')}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
