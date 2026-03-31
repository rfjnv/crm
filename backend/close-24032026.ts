import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const targetTitle = 'Сделка от 24.03.2026';
  console.log(`Поиск сделок с названием, содержащим "${targetTitle}"...`);

  // Находим все сделки с таким же названием (без учета регистра)
  const deals = await prisma.deal.findMany({
    where: {
      title: {
        contains: targetTitle,
        mode: 'insensitive',
      },
      status: {
        not: 'CLOSED', // Исключаем те, которые уже закрыты
      }
    },
  });

  console.log(`Найдено подходящих сделок (не в статусе CLOSED): ${deals.length}`);

  if (deals.length > 0) {
    const updated = await prisma.deal.updateMany({
      where: {
        id: { in: deals.map(d => d.id) }
      },
      data: {
        status: 'CLOSED' // Переводим в статус "Закрыто"
      }
    });

    console.log(`Успешно переведено в статус CLOSED (Закрыто): ${updated.count} сделок.`);
  } else {
    console.log('Нет сделок для обновления.');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
