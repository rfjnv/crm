/**
 * Проверка дат поступлений ADD на склад клиента (без правок).
 *
 * Usage (из папки backend):
 *   npx tsx src/scripts/verify-client-stock-add-dates.ts
 *   npx tsx src/scripts/verify-client-stock-add-dates.ts --client "ппс" --sku "лам92"
 */
import * as dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient({ log: [] });

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function fmtTashkent(d: Date): string {
  return d.toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'medium' });
}

async function main() {
  const clientQ = arg('--client', 'ппс').trim();
  const skuQ = arg('--sku', 'лам92').trim();

  if (!process.env.DATABASE_URL) {
    console.error('Нет DATABASE_URL в .env — подключитесь к БД или скопируйте .env из Render.');
    process.exit(1);
  }

  const rows = await prisma.clientStockEvent.findMany({
    where: {
      type: 'ADD',
      client: { companyName: { contains: clientQ, mode: 'insensitive' } },
      product: { sku: { contains: skuQ, mode: 'insensitive' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      createdAt: true,
      qtyDelta: true,
      unitPrice: true,
      lineTotal: true,
      client: { select: { id: true, companyName: true } },
      product: { select: { id: true, name: true, sku: true } },
    },
  });

  if (rows.length === 0) {
    console.log(`Событий ADD не найдено (client ~ "${clientQ}", sku ~ "${skuQ}").`);
    console.log('Проверьте написание клиента/артикула или задайте: --client "..." --sku "..."');
    process.exit(0);
  }

  console.log(`Найдено: ${rows.length} (последние по дате события)\n`);
  for (const r of rows) {
    const qty = Number(r.qtyDelta);
    console.log('—'.repeat(72));
    console.log('eventId:   ', r.id);
    console.log('client:    ', r.client.companyName, `(${r.client.id})`);
    console.log('product:   ', r.product.name, '| sku:', r.product.sku);
    console.log('qty:       ', qty);
    console.log('UTC:       ', r.createdAt.toISOString());
    console.log('Ташкент:   ', fmtTashkent(r.createdAt));
    console.log('цена/сумма:', r.unitPrice?.toString() ?? '—', '/', r.lineTotal?.toString() ?? '—');
  }
  console.log('—'.repeat(72));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
