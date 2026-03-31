import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const clientNames = ['е гранд', 'ламинация цех'];

  for (const name of clientNames) {
    const client = await prisma.client.findFirst({
      where: { companyName: { contains: name, mode: 'insensitive' } },
      select: { id: true, companyName: true },
    });
    if (!client) { console.log(`"${name}" not found`); continue; }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`CLIENT: ${client.companyName} (${client.id})`);
    console.log('='.repeat(80));

    const deals = await prisma.deal.findMany({
      where: { clientId: client.id },
      include: {
        items: { select: { id: true, requestedQty: true, price: true, sourceOpType: true, closingBalance: true, product: { select: { name: true } } } },
        payments: { select: { id: true, amount: true, method: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`Total deals: ${deals.length}\n`);

    for (const deal of deals) {
      const balance = Number(deal.amount) - Number(deal.paidAmount);
      const itemCount = deal.items.length;
      const payCount = deal.payments.length;
      const hasClosingBalance = deal.items.some(i => i.closingBalance !== null);
      const cbSum = deal.items.reduce((s, i) => s + Number(i.closingBalance ?? 0), 0);

      // Flag suspicious deals
      const flags: string[] = [];
      if (deal.title.includes('Сверка')) flags.push('SVERKA');
      if (balance > 0 && !hasClosingBalance) flags.push('NO_CB');
      if (itemCount === 0 && payCount === 0) flags.push('EMPTY');
      if (deal.amount === deal.paidAmount && Number(deal.amount) === 0) flags.push('ZERO');

      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';

      console.log(`  ${deal.title}${flagStr}`);
      console.log(`    status=${deal.status} payStatus=${deal.paymentStatus} archived=${deal.isArchived}`);
      console.log(`    amount=${Number(deal.amount).toLocaleString('ru-RU')} paid=${Number(deal.paidAmount).toLocaleString('ru-RU')} balance=${balance.toLocaleString('ru-RU')}`);
      console.log(`    items=${itemCount} payments=${payCount} hasCB=${hasClosingBalance} cbSum=${Math.round(cbSum).toLocaleString('ru-RU')}`);

      if (flags.length > 0) {
        // Show items for flagged deals
        for (const item of deal.items.slice(0, 5)) {
          console.log(`      item: ${item.product.name} qty=${Number(item.requestedQty)} price=${Number(item.price)} op=${item.sourceOpType} cb=${Number(item.closingBalance ?? 0)}`);
        }
        if (deal.items.length > 5) console.log(`      ... and ${deal.items.length - 5} more items`);
      }
    }

    // Summary: which deals contribute to old "amount-paid" debt
    const debtDeals = deals.filter(d => !d.isArchived && !['CANCELED','REJECTED'].includes(d.status));
    const totalOldDebt = debtDeals.reduce((s, d) => s + Number(d.amount) - Number(d.paidAmount), 0);
    console.log(`\n  SUMMARY: ${debtDeals.length} active deals, old debt total: ${totalOldDebt.toLocaleString('ru-RU')}`);

    // Find deals that should probably be deleted
    const suspicious = debtDeals.filter(d => {
      const balance = Number(d.amount) - Number(d.paidAmount);
      return (balance > 0 && d.items.every(i => i.closingBalance === null)) || d.title.includes('Сверка');
    });
    if (suspicious.length > 0) {
      console.log(`\n  SUSPICIOUS DEALS (no closingBalance or Сверка):`);
      for (const d of suspicious) {
        const bal = Number(d.amount) - Number(d.paidAmount);
        console.log(`    "${d.title}" balance=${bal.toLocaleString('ru-RU')} id=${d.id}`);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
