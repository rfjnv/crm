import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find the reconciliation payments/changes made by the sync
  const recentPayments = await prisma.payment.findMany({
    where: { note: { contains: 'Сверка CRM-Excel' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, amount: true, clientId: true, dealId: true, note: true, createdAt: true },
  });
  console.log('Recent sync payments:', recentPayments.length);
  for (const p of recentPayments) {
    console.log(`  ${p.id}: amount=${p.amount}, client=${p.clientId}, note=${p.note}`);
  }

  // Check current prepayments (clients with negative net balance)
  const prepayments = await prisma.$queryRaw<{client_id: string, name: string, net: string}[]>(
    Prisma.sql`
      SELECT c.id as client_id, c.company_name as name,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
      GROUP BY c.id, c.company_name
      HAVING SUM(d.amount - d.paid_amount) < -1
      ORDER BY SUM(d.amount - d.paid_amount) ASC
    `
  );
  console.log(`\nClients with prepayments (negative balance): ${prepayments.length}`);
  let totalPrepay = 0;
  for (const p of prepayments) {
    const net = Number(p.net);
    totalPrepay += net;
    console.log(`  ${p.name}: ${net.toLocaleString('ru-RU')}`);
  }
  console.log(`Total prepayments: ${totalPrepay.toLocaleString('ru-RU')}`);

  // Check the CRM-only clients that were REDUCED
  const crmOnlyReduced = [
    'фужи принт', 'эко пак', 'кузи ожизлар босмахонаси', 'эко стар полиграф',
    'хумо принт', 'глосса', 'кафолат мебел', 'юнион колор', 'хаёт нашр',
    'дилфуза принт', 'селена трейд', 'аликсей хан', 'васака пак', 'пропел груп',
    'гофур гулом', 'моварауннахр', 'баркаст полиграф', 'лион принт', 'анис полиграф',
    'СПС', 'ургут колор', 'фото экспрес', 'доссо груп', 'шарк', 'тимур дилшод',
  ];

  console.log('\n\nCRM-only clients that were reduced (should be restored):');
  for (const name of crmOnlyReduced) {
    const client = await prisma.client.findFirst({ where: { companyName: { equals: name, mode: 'insensitive' } }, select: { id: true, companyName: true } });
    if (!client) {
      console.log(`  ${name}: NOT FOUND`);
      continue;
    }
    const debtResult = await prisma.$queryRaw<{net: string}[]>(
      Prisma.sql`SELECT COALESCE(SUM(amount - paid_amount), 0)::text as net FROM deals WHERE client_id = ${client.id} AND is_archived = false`
    );
    console.log(`  ${client.companyName}: net=${Number(debtResult[0].net).toLocaleString('ru-RU')}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
