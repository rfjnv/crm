import { PrismaClient } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

const targets = [
  'жакар.уз', 'фуркат андижон', 'оригинал пак', 'ятт.одил',
  'иззатилла принт', 'эгамберди', 'принт экспресс', 'суннат',
  'баходир ака душанбе'
];

async function main() {
  const allClients = await prisma.client.findMany({ select: { id: true, companyName: true } });

  for (const target of targets) {
    let clientId = '';
    let clientName = '';
    for (const c of allClients) {
      if (normalizeClientName(c.companyName) === target) {
        clientId = c.id;
        clientName = c.companyName;
        break;
      }
    }

    if (!clientId) {
      console.log(`${target}: NOT FOUND IN CRM`);
      continue;
    }

    const deals = await prisma.deal.findMany({
      where: { clientId },
      select: { id: true, amount: true, paidAmount: true, paymentStatus: true, status: true, isArchived: true },
    });

    const payments = await prisma.payment.findMany({
      where: { clientId },
      select: { id: true, amount: true, note: true, dealId: true },
    });

    const reconPayments = payments.filter(p => p.note && p.note.includes('Сверка'));
    const activeDeals = deals.filter(d => !d.isArchived && d.status !== 'CANCELED' && d.status !== 'REJECTED');
    const debtDeals = activeDeals.filter(d => d.paymentStatus === 'UNPAID' || d.paymentStatus === 'PARTIAL');

    console.log(`\n=== ${target} (${clientName}) ===`);
    console.log(`  Total deals: ${deals.length}, Active: ${activeDeals.length}, With debt: ${debtDeals.length}`);

    let totalDebt = 0;
    for (const d of debtDeals) {
      const debt = Number(d.amount) - Number(d.paidAmount);
      if (debt > 0) totalDebt += debt;
    }
    console.log(`  CRM debt (UNPAID/PARTIAL active): ${totalDebt}`);

    for (const d of deals) {
      console.log(`    ${d.status.padEnd(12)} ${d.paymentStatus.padEnd(10)} arch=${d.isArchived} amt=${Number(d.amount)} paid=${Number(d.paidAmount)} debt=${Number(d.amount) - Number(d.paidAmount)}`);
    }

    console.log(`  Payments: ${payments.length}, Reconciliation: ${reconPayments.length}`);
    for (const p of reconPayments) {
      console.log(`    recon: amt=${Number(p.amount)} deal=${p.dealId ? 'YES' : 'NULL'} note="${(p.note || '').substring(0, 50)}"`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
