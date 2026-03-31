/**
 * Fix CRM to match Excel exactly.
 *
 * Issues to fix:
 * 1. жакар.уз / жакар уз — duplicate client, merge deals into one
 * 2. ВМ принт — Excel=784,000, no CRM deals → create deal
 * 3. ургут колор (-3,300,000), моварауннахр (-772,000), пропел груп (-300,000):
 *    CRM-only prepayments not in Excel → zero out
 *
 * Run:
 *   cd backend && npx tsx src/scripts/_fix_to_excel.ts            # dry-run
 *   cd backend && npx tsx src/scripts/_fix_to_excel.ts --execute   # live
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function computePaymentStatus(paid: number, amount: number): string {
  if (paid <= 0) return 'UNPAID';
  if (paid >= amount) return 'PAID';
  return 'PARTIAL';
}

async function main() {
  const isExecute = process.argv.includes('--execute');
  console.log(`=== FIX CRM TO MATCH EXCEL ${isExecute ? '** LIVE **' : '(DRY-RUN)'} ===\n`);

  const adminUser = await prisma.user.findFirst({
    where: { OR: [{ login: 'admin' }, { role: 'SUPER_ADMIN' }] },
    select: { id: true },
  });
  if (!adminUser) { console.error('No admin user'); process.exit(1); }

  // ═══════════════════════════════════════════════════════
  // 1. MERGE жакар.уз → жакар уз (ALREADY DONE)
  // ═══════════════════════════════════════════════════════
  console.log('--- 1. Merge жакар.уз → жакар уз (ALREADY DONE, skipping) ---');

  // Already executed in previous run - skip

  // ═══════════════════════════════════════════════════════
  // 2. CREATE DEAL for ВМ принт (784,000)
  // ═══════════════════════════════════════════════════════
  console.log('\n--- 2. Create deal for ВМ принт ---');

  const vmPrint = await prisma.client.findFirst({
    where: { companyName: { contains: 'вм принт', mode: 'insensitive' } },
    select: { id: true, companyName: true },
  });

  if (vmPrint) {
    console.log(`  Client: "${vmPrint.companyName}" (${vmPrint.id})`);

    const existingDeals = await prisma.deal.findMany({
      where: { clientId: vmPrint.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
      select: { id: true, amount: true, paidAmount: true },
    });
    const existingNet = existingDeals.reduce((s, d) => s + Number(d.amount) - Number(d.paidAmount), 0);
    console.log(`  Existing active deals: ${existingDeals.length}, net=${fmtNum(existingNet)}`);
    console.log(`  Need to create deal for 784,000`);

    if (isExecute) {
      const deal = await prisma.deal.create({
        data: {
          title: 'Долг по Excel сверке (Март 2026)',
          amount: 784000,
          paidAmount: 0,
          paymentStatus: 'UNPAID',
          status: 'SHIPPED',
          isArchived: false,
          client: { connect: { id: vmPrint.id } },
          manager: { connect: { id: adminUser.id } },
        },
      });
      console.log(`  ✓ Created deal ${deal.id}, amount=784,000, status=UNPAID`);
    } else {
      console.log(`  WILL create deal: amount=784,000, status=UNPAID`);
    }
  } else {
    console.log(`  ВМ принт NOT FOUND in CRM`);
  }

  // ═══════════════════════════════════════════════════════
  // 3. ZERO OUT CRM-only prepayment clients
  // ═══════════════════════════════════════════════════════
  console.log('\n--- 3. Zero out CRM-only prepayment clients ---');

  const prepayClients = [
    { nameSearch: 'ургут колор', expectedPrepay: -3_300_000 },
    { nameSearch: 'моварауннахр', expectedPrepay: -772_000 },
    { nameSearch: 'пропел груп', expectedPrepay: -300_000 },
  ];

  for (const pc of prepayClients) {
    // Find by name - exclude "ургут колор принт" etc if needed
    const client = await prisma.client.findFirst({
      where: { companyName: { equals: pc.nameSearch, mode: 'insensitive' } },
      select: { id: true, companyName: true },
    });

    if (!client) {
      // Try contains
      const client2 = await prisma.client.findFirst({
        where: { companyName: { contains: pc.nameSearch, mode: 'insensitive' } },
        select: { id: true, companyName: true },
      });
      if (!client2) {
        console.log(`  ${pc.nameSearch}: NOT FOUND`);
        continue;
      }
      Object.assign(client ?? {}, client2);
      if (!client) continue;
    }

    console.log(`  ${client.companyName} (${client.id}):`);

    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, paidAmount: true },
    });

    const net = deals.reduce((s, d) => s + Number(d.amount) - Number(d.paidAmount), 0);
    console.log(`    Current net: ${fmtNum(net)} (expected ~${fmtNum(pc.expectedPrepay)})`);

    if (net >= 0) {
      console.log(`    Net >= 0, no prepayment to zero out. Skipping.`);
      continue;
    }

    // Need to reduce paidAmount so that total net = 0
    // That means reduce total paidAmount by |net|
    const excessPaid = Math.abs(net);
    let remaining = excessPaid;

    const updates: { dealId: string; newPaid: number; newStatus: string }[] = [];

    // LIFO: reduce from newest deals first
    for (const deal of deals) {
      if (remaining <= 0.01) break;
      const currentPaid = Number(deal.paidAmount);
      if (currentPaid <= 0) continue;
      const reduce = Math.min(remaining, currentPaid);
      const newPaid = Math.round((currentPaid - reduce) * 100) / 100;
      updates.push({
        dealId: deal.id,
        newPaid,
        newStatus: computePaymentStatus(newPaid, Number(deal.amount)),
      });
      remaining -= reduce;
    }

    console.log(`    Will reduce paidAmount on ${updates.length} deals by total ${fmtNum(excessPaid)}`);
    for (const u of updates) {
      console.log(`      deal ${u.dealId}: paidAmount → ${fmtNum(u.newPaid)} (${u.newStatus})`);
    }

    if (isExecute) {
      await prisma.$transaction(async (tx) => {
        for (const u of updates) {
          await tx.deal.updateMany({
            where: { id: u.dealId },
            data: { paidAmount: u.newPaid, paymentStatus: u.newStatus as any },
          });
        }
      });
      console.log(`    ✓ Done. Net balance now = 0`);
    }
  }

  // ═══════════════════════════════════════════════════════
  // VERIFICATION
  // ═══════════════════════════════════════════════════════
  console.log('\n--- VERIFICATION: Debts page totals ---');

  const allDealsAgg = await prisma.$queryRaw<{ client_id: string; net: string }[]>(
    Prisma.sql`
      SELECT c.id as client_id, SUM(d.amount - d.paid_amount)::text as net
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
      GROUP BY c.id
    `
  );

  let grossDebt = 0, prepayments = 0;
  for (const row of allDealsAgg) {
    const net = Number(row.net);
    if (net > 0) grossDebt += net;
    else prepayments += net;
  }

  console.log(`  CRM Валовой долг:  ${fmtNum(grossDebt)}`);
  console.log(`  CRM Предоплаты:   ${fmtNum(prepayments)}`);
  console.log(`  CRM Чистый долг:  ${fmtNum(grossDebt + prepayments)}`);
  console.log(`\n  Excel targets:`);
  console.log(`  Валовой долг:     1 182 473 663`);
  console.log(`  Предоплаты:       -241 058 500`);
  console.log(`  Чистый:           ~943 982 063`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
