import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@prisma/client';

console.log('Using DB:', process.env.DATABASE_URL?.split('@')[1] || 'NOT SET');

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Исправление артикулов импортированных товаров...');

  // Находим все товары, у которых артикул начинается с "IMPORT-"
  const importedProducts = await prisma.product.findMany({
    where: {
      sku: { startsWith: 'IMPORT-' },
    },
    select: { id: true, name: true, sku: true },
  });

  if (importedProducts.length === 0) {
    console.log('✅ Не найдено товаров с артикулом "IMPORT-...". Все уже исправлено.');
    return;
  }

  console.log(`Найдено ${importedProducts.length} товаров. Обновляем артикул на название...`);

  // Загружаем все существующие артикулы, чтобы избежать дубликатов (Prisma sku @unique)
  const allProducts = await prisma.product.findMany({
    select: { sku: true },
  });
  
  const existingSkus = new Set(allProducts.map(p => p.sku.toLowerCase()));
  
  let updatedCount = 0;
  let skippedCount = 0;

  for (const product of importedProducts) {
    // В качестве базового артикула берем само название товара
    let newSku = product.name.trim();

    // Защита от пустых значений
    if (!newSku) {
      newSku = product.sku; // Оставляем текущий IMPORT-..., если название пустое
    }

    // Если артикул (название) уже занят другим товаром, добавляем числовой суффикс
    let finalSku = newSku;
    let suffixCounter = 1;
    
    // Проверка на уникальность перед обновлением
    while (existingSkus.has(finalSku.toLowerCase()) && finalSku.toLowerCase() !== product.sku.toLowerCase()) {
      finalSku = `${newSku}-${suffixCounter}`;
      suffixCounter++;
    }

    if (product.sku !== finalSku) {
      try {
        await prisma.product.update({
          where: { id: product.id },
          data: { sku: finalSku },
        });
        
        // Запоминаем, что этот артикул теперь занят
        existingSkus.add(finalSku.toLowerCase());
        updatedCount++;
        console.log(`  [OK] ${product.sku} -> ${finalSku}`);
      } catch (err) {
        console.error(`  [ОШИБКА] Не удалось обновить артикул ${product.sku}: ${err}`);
      }
    } else {
      skippedCount++;
    }
  }

  console.log(`🎉 Готово! Успешно обновлено: ${updatedCount}. Пропущено: ${skippedCount}.`);
}

main()
  .catch((e) => {
    console.error('Критическая ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
