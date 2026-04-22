import * as dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

const TURKEY = 'Турция';
const CHINA = 'Китай';

/**
 * Одна атомарная операция: только строки с пустой страной.
 * Турция: категория содержит «хим» (без учёта регистра) или в артикуле есть «turk».
 * Китай: все остальные с пустой страной.
 * Ничего не удаляет; уже заполненная страна не меняется.
 */
async function main() {
  console.log('Обновляю страну товаров (только пустое country_of_origin), одним UPDATE...');

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE products
    SET country_of_origin = CASE
      WHEN (
        COALESCE(category, '') ILIKE '%хим%'
        OR LOWER(sku) LIKE '%turk%'
      ) THEN '${TURKEY}'
      ELSE '${CHINA}'
    END
    WHERE country_of_origin IS NULL
       OR TRIM(BOTH FROM country_of_origin) = '';
  `);

  const stillEmpty = await prisma.product.count({
    where: {
      OR: [{ countryOfOrigin: null }, { countryOfOrigin: '' }],
    },
  });

  console.log('Готово.');
  console.log(`Затронуто строк (сервер): ${updated}`);
  console.log(`Осталось с пустой страной: ${stillEmpty}`);
}

main()
  .catch((error) => {
    console.error('Ошибка:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
