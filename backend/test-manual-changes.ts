import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find deals that were updated AFTER the import (import creates with updatedAt = createdAt)
  // Manual changes would have updatedAt > createdAt
  const manuallyChanged = await prisma.deal.findMany({
    where: {
      updatedAt: { not: undefined },
      status: 'CLOSED',
    },
    select: {
      id: true,
      title: true,
      amount: true,
      paidAmount: true,
      paymentStatus: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { companyName: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  // Filter for deals where updatedAt differs significantly from createdAt (manual edit)
  const recent = manuallyChanged.filter(d => {
    const diff = d.updatedAt.getTime() - d.createdAt.getTime();
    return diff > 60000; // More than 1 minute difference = likely manual
  });

  console.log(`\nDeals with updatedAt >> createdAt (likely manually edited):\n`);
  const clients = new Set<string>();
  for (const d of recent) {
    const clientName = d.client?.companyName || 'Unknown';
    clients.add(clientName);
    const net = Number(d.amount) - Number(d.paidAmount);
    console.log(`  ${clientName}: "${d.title}" | amount=${d.amount}, paid=${d.paidAmount}, net=${net} | updated=${d.updatedAt.toISOString()}`);
  }

  console.log(`\n--- Unique clients with manual changes: ${clients.size} ---`);
  for (const c of clients) {
    console.log(`  • ${c}`);
  }

  // Also check for recently created payments (not from import)
  const recentPayments = await prisma.payment.findMany({
    where: {
      createdAt: { gte: new Date('2026-03-19T00:00:00Z') },
    },
    select: {
      amount: true,
      method: true,
      createdAt: true,
      deal: { select: { title: true, client: { select: { companyName: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  if (recentPayments.length > 0) {
    console.log(`\n--- Payments created today (${recentPayments.length}): ---`);
    for (const p of recentPayments) {
      console.log(`  ${p.deal?.client?.companyName}: ${p.amount} (${p.method}) at ${p.createdAt.toISOString()}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
