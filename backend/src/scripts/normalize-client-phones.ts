/**
 * Приводит телефоны клиентов к «+998 XX XXX XX XX».
 *
 *   npm run normalize:client-phones -- --dry-run   # только показать, что изменится
 *   npm run normalize:client-phones -- --apply     # записать
 *
 * Без флага работает как --dry-run. Иностранные и неполные номера не трогает — выводит списком.
 */
import 'dotenv/config';
import prisma from '../lib/prisma';
import { clientsService } from '../modules/clients/clients.service';

async function main() {
  const apply = process.argv.includes('--apply');
  const result = await clientsService.normalizeAllPhones({ dryRun: !apply });

  console.log(apply ? '=== ЗАПИСЬ ===' : '=== DRY RUN: ничего не записано ===');
  console.log(`Клиентов с телефоном: ${result.total}`);
  console.log(`${apply ? 'Изменено' : 'Будет изменено'}: ${result.updated}`);
  for (const line of result.details) console.log(`  ${line}`);
  console.log(`Не распознано (оставлены как есть): ${result.unrecognized.length}`);
  for (const line of result.unrecognized) console.log(`  ${line}`);
  if (!apply && result.updated > 0) console.log('\nЧтобы записать: добавьте --apply');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
