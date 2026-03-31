/**
 * Investigation script: Носир Кредо debt analysis
 * READ-ONLY — no data modifications
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(80));
  console.log('INVESTIGATION: Носир Кредо — Debt Analysis');
  console.log('='.repeat(80));

  // ── 1. Search for duplicate / variant clients ──
  console.log('\n── 1. CLIENT SEARCH (кредо / носир) ──\n');
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { companyName: { contains: 'кредо', mode: 'insensitive' } },
        { companyName: { contains: 'носир', mode: 'insensitive' } },
        { contactName: { contains: 'кредо', mode: 'insensitive' } },
        { contactName: { contains: 'носир', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      companyName: true,
      contactName: true,
      isArchived: true,
      createdAt: true,
    },
  });

  if (clients.length === 0) {
    console.log('No clients found matching "кредо" or "носир".');
    return;
  }

  console.log(`Found ${clients.length} client(s):\n`);
  for (const c of clients) {
    console.log(`  ID:          ${c.id}`);
    console.log(`  companyName: "${c.companyName}"`);
    console.log(`  contactName: "${c.contactName}"`);
    console.log(`  isArchived:  ${c.isArchived}`);
    console.log(`  createdAt:   ${c.createdAt.toISOString()}`);
    console.log();
  }

  const clientIds = clients.map(c => c.id);

  // ── 2. All deals for these clients ──
  console.log('\n── 2. DEALS ──\n');
  const deals = await prisma.deal.findMany({
    where: { clientId: { in: clientIds } },
    select: {
      id: true,
      title: true,
      clientId: true,
      amount: true,
      paidAmount: true,
      status: true,
      paymentStatus: true,
      isArchived: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total deals: ${deals.length}\n`);
  for (const d of deals) {
    const clientName = clients.find(c => c.id === d.clientId)?.companyName ?? '?';
    const debt = Number(d.amount) - Number(d.paidAmount);
    console.log(`  Deal:          ${d.id}`);
    console.log(`  Title:         ${d.title}`);
    console.log(`  Client:        ${clientName} (${d.clientId})`);
    console.log(`  Amount:        ${Number(d.amount).toLocaleString()}`);
    console.log(`  Paid:          ${Number(d.paidAmount).toLocaleString()}`);
    console.log(`  Debt (calc):   ${debt.toLocaleString()}`);
    console.log(`  Status:        ${d.status}`);
    console.log(`  PaymentStatus: ${d.paymentStatus}`);
    console.log(`  Archived:      ${d.isArchived}`);
    console.log(`  Created:       ${d.createdAt.toISOString()}`);
    console.log();
  }

  // ── 3. All payments for these clients ──
  console.log('\n── 3. PAYMENTS ──\n');
  const payments = await prisma.payment.findMany({
    where: { clientId: { in: clientIds } },
    select: {
      id: true,
      clientId: true,
      dealId: true,
      amount: true,
      paidAt: true,
      note: true,
      method: true,
    },
    orderBy: { paidAt: 'asc' },
  });

  console.log(`Total payments: ${payments.length}\n`);
  for (const p of payments) {
    const clientName = clients.find(c => c.id === p.clientId)?.companyName ?? '?';
    console.log(`  Payment:  ${p.id}`);
    console.log(`  Client:   ${clientName} (${p.clientId})`);
    console.log(`  Deal:     ${p.dealId}`);
    console.log(`  Amount:   ${Number(p.amount).toLocaleString()}`);
    console.log(`  PaidAt:   ${p.paidAt.toISOString()}`);
    console.log(`  Method:   ${p.method ?? 'N/A'}`);
    console.log(`  Note:     ${p.note ?? 'N/A'}`);
    console.log();
  }

  // ── 4. Manual debt calculation per client ──
  console.log('\n── 4. DEBT SUMMARY PER CLIENT ──\n');
  for (const c of clients) {
    const clientDeals = deals.filter(d => d.clientId === c.id);
    const activeDeals = clientDeals.filter(d => !d.isArchived && d.status !== 'CANCELED');
    const totalAmount = activeDeals.reduce((s, d) => s + Number(d.amount), 0);
    const totalPaid = activeDeals.reduce((s, d) => s + Number(d.paidAmount), 0);
    const calculatedDebt = totalAmount - totalPaid;

    const clientPayments = payments.filter(p => p.clientId === c.id);
    const totalPaymentsSum = clientPayments.reduce((s, p) => s + Number(p.amount), 0);

    console.log(`  Client:              "${c.companyName}" (${c.id})`);
    console.log(`  Active deals:        ${activeDeals.length}`);
    console.log(`  Total deal amount:   ${totalAmount.toLocaleString()}`);
    console.log(`  Total paid (deals):  ${totalPaid.toLocaleString()}`);
    console.log(`  Calculated debt:     ${calculatedDebt.toLocaleString()}`);
    console.log(`  Total payments sum:  ${totalPaymentsSum.toLocaleString()}`);
    console.log(`  Δ paid vs payments:  ${(totalPaid - totalPaymentsSum).toLocaleString()}`);
    console.log();
  }

  // ── 5. Cross-client payment check ──
  if (clients.length > 1) {
    console.log('\n── 5. CROSS-CLIENT ANALYSIS ──\n');
    console.log('⚠ MULTIPLE CLIENT RECORDS FOUND — possible duplicate!');
    
    const allActiveDeals = deals.filter(d => !d.isArchived && d.status !== 'CANCELED');
    const grandAmount = allActiveDeals.reduce((s, d) => s + Number(d.amount), 0);
    const grandPaid = allActiveDeals.reduce((s, d) => s + Number(d.paidAmount), 0);
    const grandDebt = grandAmount - grandPaid;
    const grandPayments = payments.reduce((s, p) => s + Number(p.amount), 0);
    
    console.log(`  Combined deal amount:   ${grandAmount.toLocaleString()}`);
    console.log(`  Combined paid (deals):  ${grandPaid.toLocaleString()}`);
    console.log(`  Combined debt:          ${grandDebt.toLocaleString()}`);
    console.log(`  Combined payments:      ${grandPayments.toLocaleString()}`);
    console.log();

    // Check if payments on client A are attached to deals on client B
    for (const p of payments) {
      const deal = deals.find(d => d.id === p.dealId);
      if (deal && deal.clientId !== p.clientId) {
        console.log(`  ❌ MISMATCH: Payment ${p.id} belongs to client ${p.clientId}`);
        console.log(`     but deal ${p.dealId} belongs to client ${deal.clientId}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('END OF INVESTIGATION');
  console.log('='.repeat(80));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
