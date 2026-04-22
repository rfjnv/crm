import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function nuclearCleanup() {
  console.log('\n=== ЯДЕРНАЯ ОЧИСТКА (SQL) ===\n');

  try {
    // Отключаем все ограничения
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "DealItem" DISABLE TRIGGER ALL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "Deal" DISABLE TRIGGER ALL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "Client" DISABLE TRIGGER ALL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "Product" DISABLE TRIGGER ALL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "InventoryMovement" DISABLE TRIGGER ALL;`);
    
    console.log('Удаляю все dealItems...');
    const items = await prisma.dealItem.deleteMany();
    console.log(`✓ Удалено dealItems: ${items.count}`);

    console.log('Удаляю все inventoryMovements...');
    const invMovements = await prisma.inventoryMovement.deleteMany();
    console.log(`✓ Удалено: ${invMovements.count}`);

    console.log('Удаляю все deals...');
    const deals = await prisma.deal.deleteMany();
    console.log(`✓ Удалено deals: ${deals.count}`);

    console.log('Удаляю всех clients...');
    const clients = await prisma.client.deleteMany();
    console.log(`✓ Удалено clients: ${clients.count}`);

    console.log('Удаляю все products...');
    const products = await prisma.product.deleteMany();
    console.log(`✓ Удалено products: ${products.count}`);

    console.log('Удаляю stock...');
    const stock = await prisma.stock.deleteMany();
    console.log(`✓ Удалено stock: ${stock.count}`);

    // Включаем триггеры обратно
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "DealItem" ENABLE TRIGGER ALL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "Deal" ENABLE TRIGGER ALL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "Client" ENABLE TRIGGER ALL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "Product" ENABLE TRIGGER ALL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "InventoryMovement" ENABLE TRIGGER ALL;`);

    // Verify
    console.log('\n=== ПРОВЕРКА ===');
    const finalDeals = await prisma.deal.count();
    const finalItems = await prisma.dealItem.count();
    const finalClients = await prisma.client.count();
    const finalProducts = await prisma.product.count();

    console.log(`Deals: ${finalDeals}`);
    console.log(`DealItems: ${finalItems}`);
    console.log(`Clients: ${finalClients}`);
    console.log(`Products: ${finalProducts}`);

    if (finalDeals === 0 && finalItems === 0 && finalClients === 0 && finalProducts === 0) {
      console.log('\n✅ DATABASE УСПЕШНО ОЧИЩЕНА!\n');
    }

  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await prisma.$disconnect();
  }
}

nuclearCleanup();
