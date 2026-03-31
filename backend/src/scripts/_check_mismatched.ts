import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const names = ['вм принт', 'баходир ака', 'регион принт', 'васака пак', 'жакар'];
  for (const name of names) {
    const clients = await prisma.client.findMany({
      where: { companyName: { contains: name, mode: 'insensitive' } },
      select: { id: true, companyName: true },
    });
    for (const client of clients) {
      console.log('');
      console.log('='.repeat(80));
      console.log('CLIENT: ' + client.companyName + ' (' + client.id + ')');
      const deals = await prisma.deal.findMany({
        where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED','REJECTED'] } },
        select: { id: true, title: true, amount: true, paidAmount: true, status: true, paymentStatus: true,
          items: { select: { id: true, sourceOpType: true, closingBalance: true, requestedQty: true, price: true, product: { select: { name: true } } } },
          payments: { select: { id: true, amount: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      console.log('Deals: ' + deals.length);
      for (const d of deals) {
        const bal = Number(d.amount) - Number(d.paidAmount);
        const debtCB = d.items.filter(i => ['K','NK','PK','F','PP'].includes(i.sourceOpType || '')).reduce((s, i) => s + Number(i.closingBalance ?? 0), 0);
        console.log('  ' + d.title + ' status=' + d.status + ' pay=' + d.paymentStatus);
        console.log('    amount=' + Number(d.amount).toLocaleString('ru-RU') + ' paid=' + Number(d.paidAmount).toLocaleString('ru-RU') + ' balance=' + bal.toLocaleString('ru-RU'));
        console.log('    items=' + d.items.length + ' payments=' + d.payments.length + ' debtCB=' + Math.round(debtCB).toLocaleString('ru-RU'));
        console.log('    id=' + d.id);
      }
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
