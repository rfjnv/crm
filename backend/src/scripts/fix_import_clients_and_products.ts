import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- 1. Объединение дубликатов товаров (артикулы с "-2") ---');

  // Ищем все товары, у которых артикул заканчивается на "-2"
  const productsWithSuffix = await prisma.product.findMany({
    where: { sku: { endsWith: '-2' } },
  });

  for (const dupProd of productsWithSuffix) {
    // Получаем оригинальный артикул: например, из "лам70-2" получаем "лам70"
    const originalSku = dupProd.sku.substring(0, dupProd.sku.length - 2).trim();
    
    const originalProd = await prisma.product.findUnique({ where: { sku: originalSku } });

    if (originalProd) {
      console.log(`\nОбъединяю товар [${dupProd.sku}] -> [${originalSku}]`);

      await prisma.$transaction(async (tx) => {
        // 1. Переносим все связанные записи в сделках (DealItems) на оригинальный товар
        const updatedDealItems = await tx.dealItem.updateMany({
          where: { productId: dupProd.id },
          data: { productId: originalProd.id },
        });
        console.log(`  - Перенесено DealItem (товаров в сделках): ${updatedDealItems.count}`);

        // 2. Переносим все движения по складу (InventoryMovement)
        const updatedMovements = await tx.inventoryMovement.updateMany({
          where: { productId: dupProd.id },
          data: { productId: originalProd.id },
        });
        console.log(`  - Перенесено InventoryMovement (история склада): ${updatedMovements.count}`);

        // 3. Добавляем остатки дубликата к оригинальному товару
        await tx.product.update({
          where: { id: originalProd.id },
          data: { stock: { increment: dupProd.stock } },
        });
        console.log(`  - Обновлён остаток для [${originalSku}]: добавлено +${dupProd.stock}`);

        // 4. Удаляем товар-дубликат
        await tx.product.delete({ where: { id: dupProd.id } });
        console.log(`  - Товар-дубликат [${dupProd.sku}] успешно удалён`);
      });
    } else {
      console.log(`\nВнимание: Оригинальный базовый товар [${originalSku}] для дубликата [${dupProd.sku}] не найден.`);
      console.log(`  -> Просто обрезаю "-2" из его артикула и оставляю в базе.`);
      try {
        await prisma.product.update({ where: { id: dupProd.id }, data: { sku: originalSku } });
      } catch (e: any) {
        console.log(`  Ошибка при переименовании: уже существует товар с таким артикулом или иная ошибка.`);
      }
    }
  }


  console.log('\n--- 2. Исправление пустых цен (0) для клиентов "Ламинация цех" и "Тимур Дилшод" ---');

  // Ищем этих конкретных клиентов
  const targetClients = await prisma.client.findMany({
    where: {
      OR: [
        { companyName: { contains: 'ламинаци', mode: 'insensitive' } },
        { contactName: { contains: 'ламинаци', mode: 'insensitive' } },
        { companyName: { contains: 'тимур', mode: 'insensitive' } },
        { contactName: { contains: 'тимур', mode: 'insensitive' } },
      ],
    },
  });

  const clientIds = targetClients.map((c) => c.id);
  console.log(`Найдено целевых клиентов в базе: ${clientIds.length}`);

  if (clientIds.length > 0) {
    targetClients.forEach(c => console.log(` - Клиент: ${c.companyName} (${c.contactName || ''})`));

    // Ищем записи о товарах в сделках, где цена 0 или null
    const badDealItems = await prisma.dealItem.findMany({
      where: {
        deal: { clientId: { in: clientIds } },
        OR: [
          { price: 0 },
          { price: null },
        ],
      },
      include: {
        product: true,
        deal: true,
      },
    });

    console.log(`Найдено товаров с ценой 0 в сделках этих клиентов: ${badDealItems.length}\n`);

    const affectedDealIds = new Set<string>();

    for (const item of badDealItems) {
      if (!item.product) continue;
      
      const correctPrice = Number(item.product.salePrice) || 0;
      
      if (correctPrice === 0) {
        console.log(`  [Пропуск] У самого товара "${item.product.name}" базовая цена (salePrice) равна 0!`);
        continue;
      }

      const qty = Number(item.requestedQty) || 0;
      const lineTotal = correctPrice * qty;

      // Обновляем позицию (устанавливаем цену и пересчитываем её сумму)
      await prisma.dealItem.update({
        where: { id: item.id },
        data: {
          price: correctPrice,
          lineTotal: lineTotal,
        },
      });

      affectedDealIds.add(item.dealId);
    }

    // Пересчет общих сумм (Total) в задетых сделках
    console.log(`\nПересчет общих сумм для задетых сделок (всего сделок: ${affectedDealIds.size})...`);
    for (const dealId of affectedDealIds) {
      const allItems = await prisma.dealItem.findMany({ where: { dealId } });
      const dealTotal = allItems.reduce((acc, item) => {
        const p = Number(item.price) || 0;
        const q = Number(item.requestedQty) || 0;
        return acc + (p * q);
      }, 0);

      const dealRec = await prisma.deal.update({
        where: { id: dealId },
        data: { amount: dealTotal },
      });
      console.log(`  Сделка [${dealRec.title || dealRec.id}] -> новая сумма: ${dealTotal}`);
    }
  } else {
    console.log(`Клиенты 'Ламинация цех' и 'Тимур Дилшод' не найдены! Проверьте правильность написания.`);
  }

  console.log('\n✅ Скрипт успешно завершён!');
}

main()
  .catch((e) => {
    console.error('Ошибка в скрипте:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
