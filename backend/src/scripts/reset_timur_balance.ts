import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Поиск клиента "Тимур Дилшод" и обнуление его задолженности/переплаты...\n');

  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { companyName: { contains: 'тимур', mode: 'insensitive' } },
        { contactName: { contains: 'тимур', mode: 'insensitive' } },
      ]
    }
  });

  if (clients.length === 0) {
    console.log('Клиент не найден!');
    return;
  }

  // Если нашлось несколько, берем первого, но лучше перепроверить
  const client = clients[0];
  console.log(`Работаем с клиентом: ${client.companyName} (ID: ${client.id})`);

  // Берем все несохраненные (не отмененные) сделки этого клиента за ВСЁ время
  const deals = await prisma.deal.findMany({
    where: {
      clientId: client.id,
      status: { notIn: ['CANCELED', 'REJECTED'] }
    },
    include: { payments: true }
  });

  console.log(`Найдено активных сделок у клиента: ${deals.length}`);

  let updatedCount = 0;

  for (const deal of deals) {
    const amount = Number(deal.amount);

    await prisma.$transaction(async (tx) => {
      // 1. Полностью сносим все текущие платежи сделки, чтобы сбросить "переплаты" и путаницу
      await tx.payment.deleteMany({ where: { dealId: deal.id } });

      // Если сумма сделки 0, то долгов по ней быть не может
      if (amount <= 0) {
        await tx.deal.update({
          where: { id: deal.id },
          data: { paidAmount: 0, paymentStatus: 'UNPAID' }
        });
        return; 
      }

      // 2. Ставим статус "Оплачено" и сумму оплат равную сумме сделки (чтобы долг стал 0)
      await tx.deal.update({
        where: { id: deal.id },
        data: {
          paidAmount: amount,
          paymentStatus: 'PAID',
        }
      });

      // 3. Создаем идеальный один платеж ровно на сумму сделки (дата равняется дате сделки)
      await tx.payment.create({
        data: {
          dealId: deal.id,
          clientId: client.id,
          amount: amount,
          method: deal.paymentMethod || 'TRANSFER',
          paidAt: deal.createdAt,
          createdBy: deal.managerId,
          note: 'Автоматический платеж для обнуления баланса',
        }
      });
    });

    updatedCount++;
    console.log(`  Сделка [${deal.title || deal.id}] -> приравнена к 0 балансу (${amount})`);
  }

  console.log(`\n✅ Успешно! Полностью сброшен баланс для ${updatedCount} сделок клиента (теперь долги и переплаты ровно 0).`);
  console.log(`Можете заходить в систему и вносить вашу ручную переплату.`);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
