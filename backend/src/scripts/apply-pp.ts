import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  АВТО-ПОГАШЕНИЕ ДОЛГОВ ЗА СЧЕТ ПП');
  console.log('═══════════════════════════════════════');

  const clients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  let appliedCount = 0;
  let totalAmountApplied = 0;

  for (const client of clients) {
    // 1. Find all deals with a POSITIVE debt (unpaid deals)
    const unpaidDeals = await prisma.deal.findMany({
      where: {
        clientId: client.id,
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    const debts = unpaidDeals.filter(d => Number(d.amount) > Number(d.paidAmount));
    const credits = unpaidDeals.filter(d => Number(d.paidAmount) > Number(d.amount));

    if (debts.length === 0 || credits.length === 0) {
      continue; // Client doesn't have overlapping debts and prepayments
    }

    console.log(`\nКлиент: ${client.companyName}`);

    // Iteratively apply credits to debts
    for (const creditDeal of credits) {
      let creditRemaining = Number(creditDeal.paidAmount) - Number(creditDeal.amount);
      if (creditRemaining <= 0) continue;

      for (const debtDeal of debts) {
        if (creditRemaining <= 0) break;
        let debtAmount = Number(debtDeal.amount) - Number(debtDeal.paidAmount);
        if (debtAmount <= 0) continue;

        const applyAmount = Math.min(creditRemaining, debtAmount);
        
        // 1. Reduce credit from the PP deal
        const newCreditPaid = Number(creditDeal.paidAmount) - applyAmount;
        await prisma.deal.update({
          where: { id: creditDeal.id },
          data: {
            paidAmount: newCreditPaid,
            paymentStatus: newCreditPaid >= Number(creditDeal.amount) ? 'PAID' : 'PARTIAL'
          }
        });

        // 2. Add credit to the Debt deal
        const newDebtPaid = Number(debtDeal.paidAmount) + applyAmount;
        await prisma.deal.update({
          where: { id: debtDeal.id },
          data: {
            paidAmount: newDebtPaid,
            paymentStatus: newDebtPaid >= Number(debtDeal.amount) ? 'PAID' : 'PARTIAL'
          }
        });

        // 3. Create a descriptive payment record link
        await prisma.payment.create({
          data: {
            amount: applyAmount,
            method: 'CASH',
            dealId: debtDeal.id,
            clientId: client.id,
            createdBy: debtDeal.managerId,
            paidAt: new Date(),
          }
        });

        // 4. Add a comment to the debt deal
        await prisma.dealComment.create({
          data: {
            text: `Автоматически погашено на сумму ${applyAmount} сум за счет передоплаты (сделка "${creditDeal.title}")`,
            dealId: debtDeal.id,
            managerId: debtDeal.managerId,
          }
        });

        // 5. Add a comment to the credit deal
        await prisma.dealComment.create({
          data: {
            text: `Передоплата на сумму ${applyAmount} сум перенесена в счет погашения долга (сделка "${debtDeal.title}")`,
            dealId: creditDeal.id,
            managerId: creditDeal.managerId,
          }
        });

        creditRemaining -= applyAmount;
        debtDeal.paidAmount = newDebtPaid as any;
        creditDeal.paidAmount = newCreditPaid as any;
        appliedCount++;
        totalAmountApplied += applyAmount;

        console.log(`  ✓ Перенесено ${applyAmount} сум из ПП "${creditDeal.title}" в долг "${debtDeal.title}"`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`  ГОТОВО!`);
  console.log(`  Сделано переносов: ${appliedCount}`);
  console.log(`  Общая сумма взаимозачёта: ${totalAmountApplied} сум`);
  console.log('═══════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch(console.error);
