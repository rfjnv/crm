/**
 * Заполняет closedAt у CLOSED-сделок, где closedAt пустой:
 *  1) DD.MM.YYYY в конце названия;
 *  2) иначе departureTime накладной;
 *  3) иначе createdAt (как просили — «как у остальных», без пустой даты).
 *
 * Запуск из каталога backend:
 *   npx tsx src/scripts/fix-closed-at-for-closed-deals.ts
 * Проверка без записи:
 *   npx tsx src/scripts/fix-closed-at-for-closed-deals.ts --dry-run
 */
import prisma from '../lib/prisma';
import { parseClosedDateFromDealTitle } from '../lib/dealClosedAt';

const BATCH = 500;
const CONCURRENCY = 40;

function resolveClosedAt(d: {
  title: string;
  createdAt: Date;
  shipment: { departureTime: Date | null } | null;
}): { at: Date; source: 'title' | 'shipment' | 'created' } {
  const fromTitle = parseClosedDateFromDealTitle(d.title);
  if (fromTitle) return { at: fromTitle, source: 'title' };
  if (d.shipment?.departureTime) {
    return { at: new Date(d.shipment.departureTime), source: 'shipment' };
  }
  return { at: d.createdAt, source: 'created' };
}

async function flushUpdates(
  rows: { id: string; at: Date }[],
  dryRun: boolean,
): Promise<void> {
  if (dryRun || rows.length === 0) return;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map((r) =>
        prisma.deal.update({
          where: { id: r.id },
          data: { closedAt: r.at },
        }),
      ),
    );
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  let lastId = '';
  let total = 0;
  let nTitle = 0;
  let nShip = 0;
  let nCreated = 0;

  for (;;) {
    const batch = await prisma.deal.findMany({
      where: {
        status: 'CLOSED',
        isArchived: false,
        closedAt: null,
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      take: BATCH,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        shipment: { select: { departureTime: true } },
      },
    });

    if (batch.length === 0) break;

    const updates: { id: string; at: Date }[] = [];

    for (const d of batch) {
      const { at, source } = resolveClosedAt(d);
      if (source === 'title') nTitle++;
      else if (source === 'shipment') nShip++;
      else nCreated++;
      updates.push({ id: d.id, at });
      total++;
    }

    await flushUpdates(updates, dryRun);

    lastId = batch[batch.length - 1]!.id;
    console.log(
      dryRun ? `[DRY-RUN] посчитано ${total} (последний id …${lastId.slice(-8)})` : `обновлено ${total}…`,
    );
  }

  const suffix = dryRun ? ' (запись в БД не выполнялась — уберите --dry-run)' : '';
  console.log(
    `Готово${suffix}. Всего CLOSED без closedAt обработано: ${total}. Из названия: ${nTitle}, из накладной: ${nShip}, из createdAt: ${nCreated}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
