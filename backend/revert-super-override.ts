import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const yesterdayStart = new Date();
  // Поиск за последние 2-3 дня для гарантии захвата "вчерашних" изменений
  yesterdayStart.setDate(yesterdayStart.getDate() - 3); 

  console.log('Поиск логов супер оверрайдов (OVERRIDE_UPDATE)...');

  const logs = await prisma.auditLog.findMany({
    where: {
      action: 'OVERRIDE_UPDATE',
      entityType: 'deal',
      createdAt: {
        gte: yesterdayStart,
      },
    },
  });

  const dealIdsToUpdate = [];

  for (const log of logs) {
    const before = log.before as any;
    const after = log.after as any;

    if (before?.status === 'READY_FOR_SHIPMENT' && after?.status === 'CLOSED') {
      dealIdsToUpdate.push(log.entityId);
    }
  }

  const uniqueDealIds = Array.from(new Set(dealIdsToUpdate));

  console.log(`Найдено ${uniqueDealIds.length} сделок, которые были перенесены из "Отгрузка" в "Закрыто" через супер оверрайд.`);

  if (uniqueDealIds.length > 0) {
    const deals = await prisma.deal.findMany({
      where: {
        id: { in: uniqueDealIds },
      }
    });

    // Берем только те, которые сейчас в статусе CLOSED (вдруг какие-то уже откатили руками)
    const readyToRevert = deals.filter(d => d.status === 'CLOSED');

    console.log(`${readyToRevert.length} из них сейчас в статусе "Закрыто" и будут возвращены на "Отгрузка".`);

    if (readyToRevert.length > 0) {
      const updated = await prisma.deal.updateMany({
        where: {
          id: { in: readyToRevert.map(d => d.id) }
        },
        data: {
          status: 'READY_FOR_SHIPMENT'
        }
      });

      console.log(`Успешно возвращено ${updated.count} сделок на статус READY_FOR_SHIPMENT (Отгрузка).`);
    } else {
      console.log('Нет сделок для возврата (все найденные сделки уже имеют другой статус).');
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
