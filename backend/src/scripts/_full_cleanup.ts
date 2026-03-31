import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️  ПОЛНАЯ ОЧИСТКА БД (все таблицы)\n');

  try {
    console.log('Удаляем все строки в правильном порядке...\n');

    const tables = [
      'payments',
      'inventory_movements',
      'deal_items',
      'deals',
      'contracts',
      'clients',
      'products',
    ];

    for (const table of tables) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM ${table}`);
        console.log(`✅ ${table}: очищена`);
      } catch (e: any) {
        console.log(`⚠️  ${table}: ${e.message.split('\n')[0]}`);
      }
    }

    console.log('\n✅ БД полностью очищена!\n');

    // Проверяем
    const counts = {
      deals: await prisma.deal.count(),
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
      dealItems: await prisma.dealItem.count(),
      payments: await prisma.payment.count(),
    };

    console.log('📊 Текущее состояние:');
    Object.entries(counts).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });

    await prisma.$disconnect();
  } catch (error: any) {
    console.error('❌ Ошибка:', error.message);
  }
}

main();
