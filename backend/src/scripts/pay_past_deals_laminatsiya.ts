import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Поиск клиента "Ламинация цех" и проставление оплат для старых сделок...');

  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { companyName: { contains: 'ламинаци', mode: 'insensitive' } },
        { contactName: { contains: 'ламинаци', mode: 'insensitive' } },
      ]
    }
  });

  if (clients.length === 0) {
    console.log('Клиент не найден!');
    return;
  }

  const client = clients[0];
  console.log(`Работаем с клиентом: ${client.companyName} (ID: ${client.id})`);

  // Берём все сделки до 17 января 2026 года (не включая 17-е)
  const endDate = new Date('2026-01-17T00:00:00.000Z');

  const oldDeals = await prisma.deal.findMany({
    where: {
      clientId: client.id,
      createdAt: { lt: endDate },
      status: { notIn: ['CANCELED', 'REJECTED'] }
    },
    include: { payments: true }
  });

  console.log(`Найдено старых сделок до 17.01.2026: ${oldDeals.length}`);

  let updatedCount = 0;

  for (const deal of oldDeals) {
    const amount = Number(deal.amount);
    
    // Если сумма 0 или уже полностью оплачена — пропускаем
    if (amount <= 0 || (deal.paymentStatus === 'PAID' && Number(deal.paidAmount) >= amount)) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // Очищаем старые неверные или частичные платежи для этой сделки
      await tx.payment.deleteMany({ where: { dealId: deal.id } });

      // Обновляем статус сделки на полностью оплаченную
      await tx.deal.update({
        where: { id: deal.id },
        data: {
          paidAmount: amount,
          paymentStatus: 'PAID',
        }
      });

      // Создаём запись о платеже, ДАТА ПЛАТЕЖА = ДАТА СДЕЛКИ
      await tx.payment.create({
        data: {
          dealId: deal.id,
          clientId: client.id,
          amount: amount,
          method: 'TRANSFER', // По умолчанию ставим Перечисление (или CASH)
          paidAt: deal.createdAt, // Берём дату сделки
          createdBy: deal.managerId,
          note: 'Автоматическое погашение старой сделки'
        }
      });
    });

    updatedCount++;
    console.log(`  Сделка [${deal.title || deal.id}] на сумму ${amount} полностью оплачена (Дата: ${deal.createdAt.toISOString().split('T')[0]})`);
  }

  console.log(`\nУспешно! Исправлено сделок: ${updatedCount}`);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
