/**
 * net_overpayments.ts
 *
 * Для каждого клиента:
 *  1. Находит сделки с переплатой (paidAmount > amount)
 *  2. Находит сделки с долгом (paidAmount < amount)
 *  3. Перекидывает сумму переплаты на погашение долга
 *     (уменьшает paidAmount у переплаченной сделки, создаёт платёж и обновляет paidAmount у должника)
 *  4. Обновляет paymentStatus у обеих сделок
 *
 * Запуск: npx tsx src/scripts/net_overpayments.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Запуск зачёта переплат против долгов...\n');

  // Берём всех клиентов у которых есть сделки
  const clients = await prisma.client.findMany({
    select: { id: true, companyName: true },
  });

  let totalTransfers = 0;
  let totalClients = 0;

  for (const client of clients) {
    const deals = await prisma.deal.findMany({
      where: {
        clientId: client.id,
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Считаем баланс на каждую сделку
    const overpaid = deals.filter(d => Number(d.paidAmount) > Number(d.amount));
    const indebted = deals.filter(d => Number(d.paidAmount) < Number(d.amount));

    if (overpaid.length === 0 || indebted.length === 0) continue;

    console.log(`\n📋 Клиент: ${client.companyName}`);

    let clientTransfers = 0;

    for (const src of overpaid) {
      let surplus = Number(src.paidAmount) - Number(src.amount);
      if (surplus <= 0) continue;

      for (const dst of indebted) {
        const gap = Number(dst.amount) - Number(dst.paidAmount);
        if (gap <= 0) continue;

        const transfer = Math.min(surplus, gap);
        if (transfer <= 0.01) continue;

        console.log(
          `  ✂️  Перекидываем ${transfer.toLocaleString('ru')} ` +
          `из "${src.title}" (${src.id.slice(0, 8)}) ` +
          `→ "${dst.title}" (${dst.id.slice(0, 8)})`
        );

        await prisma.$transaction(async (tx) => {
          // 1. Уменьшаем переплату в исходной сделке
          const newSrcPaid = Number(src.paidAmount) - transfer;
          const newSrcStatus = newSrcPaid >= Number(src.amount) ? 'PAID'
            : newSrcPaid > 0 ? 'PARTIAL' : 'UNPAID';

          await tx.deal.update({
            where: { id: src.id },
            data: {
              paidAmount: newSrcPaid,
              paymentStatus: newSrcStatus as any,
            },
          });

          // 2. Удаляем лишние платежи из исходной сделки (уменьшаем последний на сумму transfer)
          const srcPayments = await tx.payment.findMany({
            where: { dealId: src.id },
            orderBy: { paidAt: 'desc' },
          });
          let toRemove = transfer;
          for (const p of srcPayments) {
            if (toRemove <= 0) break;
            const pAmt = Number(p.amount);
            if (pAmt <= toRemove) {
              await tx.payment.delete({ where: { id: p.id } });
              toRemove -= pAmt;
            } else {
              await tx.payment.update({
                where: { id: p.id },
                data: { amount: pAmt - toRemove },
              });
              toRemove = 0;
            }
          }

          // 3. Увеличиваем оплату в сделке-должнике
          const newDstPaid = Number(dst.paidAmount) + transfer;
          const newDstStatus = newDstPaid >= Number(dst.amount) ? 'PAID'
            : newDstPaid > 0 ? 'PARTIAL' : 'UNPAID';

          await tx.deal.update({
            where: { id: dst.id },
            data: {
              paidAmount: newDstPaid,
              paymentStatus: newDstStatus as any,
            },
          });

          // 4. Создаём новый платёж в сделке-должнике
          await tx.payment.create({
            data: {
              dealId: dst.id,
              clientId: client.id,
              amount: transfer,
              method: src.paymentMethod || 'TRANSFER',
              paidAt: dst.createdAt,
              createdBy: dst.managerId,
              note: `Зачёт переплаты из сделки "${src.title}"`,
            },
          });
        });

        // Обновляем локальные значения для следующих итераций
        (src as any).paidAmount = Number(src.paidAmount) - transfer;
        (dst as any).paidAmount = Number(dst.paidAmount) + transfer;

        surplus -= transfer;
        clientTransfers++;
        totalTransfers++;

        if (surplus <= 0.01) break;
      }
    }

    if (clientTransfers > 0) {
      console.log(`  ✅ Выполнено зачётов: ${clientTransfers}`);
      totalClients++;
    }
  }

  console.log(`\n✅ Готово! Выполнено ${totalTransfers} зачётов по ${totalClients} клиентам.`);
}

main()
  .catch(e => { console.error('❌ Ошибка:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
