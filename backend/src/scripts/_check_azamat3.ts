import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const deal = await p.deal.findFirst({
    where: {
      title: 'Сделка от 10.03.2026',
      client: { companyName: { contains: 'азамат андижон', mode: 'insensitive' } },
    },
    select: { id: true, title: true, amount: true, paidAmount: true, status: true, paymentStatus: true,
      items: { select: { id: true, requestedQty: true, price: true, product: { select: { name: true } } } },
      payments: { select: { id: true, amount: true, note: true } },
    },
  });
  if (!deal) { console.log('Deal not found'); return; }
  console.log('Deal:', deal.id);
  console.log('Title:', deal.title);
  console.log('Amount:', Number(deal.amount).toLocaleString());
  console.log('Paid:', Number(deal.paidAmount).toLocaleString());
  console.log('Status:', deal.status, deal.paymentStatus);
  console.log('\nItems:');
  for (const item of deal.items) {
    console.log('  ', item.product.name, '| qty:', Number(item.requestedQty), '| price:', Number(item.price).toLocaleString());
  }
  console.log('\nPayments:', deal.payments.length);
  for (const pay of deal.payments) {
    console.log('  ', Number(pay.amount).toLocaleString(), '|', pay.note);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
