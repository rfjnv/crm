import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find all March 2026 deals
  const marchDeals = await prisma.deal.findMany({
    where: { title: { contains: 'Март 2026' }, status: 'CLOSED' },
    select: { id: true, title: true, clientId: true, amount: true, paidAmount: true },
  });

  console.log(`Found ${marchDeals.length} March 2026 deals\n`);

  let updated = 0;
  for (const deal of marchDeals) {
    // Sum closingBalance for debt types per deal
    const result = await prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN source_op_type IN ('K','NK','PK','F','PP')
          THEN COALESCE(closing_balance, 0) ELSE 0 END
      ), 0)::text AS total
      FROM deal_items
      WHERE deal_id = ${deal.id}
        AND closing_balance IS NOT NULL
    `;

    const cbTotal = Number(result[0]?.total ?? 0);
    const oldAmount = Number(deal.amount);
    const oldPaid = Number(deal.paidAmount);
    const oldBalance = oldAmount - oldPaid;

    if (cbTotal === 0 && oldBalance === 0) continue; // no debt, skip

    // New amount = cbTotal (the real debt from Excel)
    // paidAmount stays 0 since balance = amount - paid = cbTotal
    const newAmount = cbTotal;
    const newPaid = 0;
    const newPaymentStatus = newAmount > 0 ? 'UNPAID' : (newAmount < 0 ? 'PAID' : 'PAID');

    if (Math.round(newAmount) !== Math.round(oldAmount) || Math.round(newPaid) !== Math.round(oldPaid)) {
      await prisma.deal.update({
        where: { id: deal.id },
        data: {
          amount: newAmount,
          paidAmount: newPaid,
          paymentStatus: newPaymentStatus,
        },
      });
      updated++;
      console.log(`  ${deal.title}`);
      console.log(`    old: amount=${oldAmount.toLocaleString('ru-RU')} paid=${oldPaid.toLocaleString('ru-RU')} balance=${oldBalance.toLocaleString('ru-RU')}`);
      console.log(`    new: amount=${Math.round(newAmount).toLocaleString('ru-RU')} paid=0 balance=${Math.round(newAmount).toLocaleString('ru-RU')}`);
    }
  }

  console.log(`\nUpdated ${updated} deals.`);

  // Verify top clients
  console.log('\n=== Verification ===');
  const check = ['е гранд', 'ламинация цех', 'кампютер мужизаси', 'азамат андижон'];
  for (const name of check) {
    const client = await prisma.client.findFirst({
      where: { companyName: { contains: name, mode: 'insensitive' } },
      select: { id: true, companyName: true },
    });
    if (!client) continue;

    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, title: { contains: 'Март 2026' } },
      select: { title: true, amount: true, paidAmount: true },
    });

    for (const d of deals) {
      const bal = Number(d.amount) - Number(d.paidAmount);
      console.log(`  ${d.title}: amount=${Number(d.amount).toLocaleString('ru-RU')} balance=${bal.toLocaleString('ru-RU')}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
