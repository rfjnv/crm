/**
 * Одноразово выставляет closedAt для всех CLOSED сделок:
 * 1) дата DD.MM.YYYY в конце названия (как «Сделка — 05.03.2026»);
 * 2) иначе время отправки из накладной (shipment.departureTime).
 *
 * Запуск из корня backend:
 *   npx tsx src/scripts/fix-closed-at-for-closed-deals.ts
 */
import prisma from '../lib/prisma';
import { parseClosedDateFromDealTitle } from '../lib/dealClosedAt';

async function main() {
  const deals = await prisma.deal.findMany({
    where: { status: 'CLOSED', isArchived: false },
    select: {
      id: true,
      title: true,
      closedAt: true,
      shipment: { select: { departureTime: true } },
    },
  });

  let updated = 0;
  let skipped = 0;

  for (const d of deals) {
    const fromTitle = parseClosedDateFromDealTitle(d.title);
    const fromShipment = d.shipment?.departureTime ?? null;
    const next = fromTitle ?? fromShipment;
    if (!next) {
      skipped++;
      continue;
    }
    await prisma.deal.update({ where: { id: d.id }, data: { closedAt: next } });
    updated++;
  }

  console.log(`Готово. Обновлено closedAt: ${updated}, нет даты в названии и нет накладной: ${skipped}, всего CLOSED: ${deals.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
