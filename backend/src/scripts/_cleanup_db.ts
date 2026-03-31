import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️  ПОЛНАЯ ОЧИСТКА БД...\n');

  try {
    // Удаляем в обратном порядке зависимостей
    console.log('Удаляем payments...');
    await prisma.payment.deleteMany({});

    console.log('Удаляем inventoryMovements...');
    await prisma.inventoryMovement.deleteMany({});

    console.log('Удаляем dealItems...');
    await prisma.dealItem.deleteMany({});

    console.log('Удаляем deals...');
    await prisma.deal.deleteMany({});

    console.log('Удаляем contracts...');
    await prisma.contract.deleteMany({});

    console.log('Удаляем clients...');
    await prisma.client.deleteMany({});

    console.log('Удаляем products...');
    await prisma.product.deleteMany({});

    console.log('✅ БД полностью очищена!');

    // Проверяем
    const stats = {
      deals: await prisma.deal.count(),
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
      dealItems: await prisma.dealItem.count(),
      payments: await prisma.payment.count(),
      movements: await prisma.inventoryMovement.count(),
    };

    console.log('\n📊 Текущее состояние БД:');
    Object.entries(stats).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

main();
