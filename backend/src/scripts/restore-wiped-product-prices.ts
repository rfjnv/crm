/**
 * Восстановление цен товаров, стёртых багом частичного PATCH `/inventory/products/:id`.
 *
 * До фикса DTO превращал отсутствующий ключ в `null`, поэтому любое частичное
 * обновление товара (переключатель «Активен», установка ярлыка, правка описания,
 * а также правка карточки обычным ADMIN — у него не рендерится поле «Цена закупки»)
 * записывало NULL в purchase_price / sale_price / installment_price.
 *
 * Аудит-лог цены не сохранял, поэтому точное прежнее значение недоступно.
 * Скрипт восстанавливает salePrice по последней фактической цене продажи товара
 * (deal_items.price), а purchasePrice — по последней закупке (import_order_items).
 *
 * По умолчанию — только отчёт, БД не меняется. Записать: `--apply`.
 *
 *   npx tsx src/scripts/restore-wiped-product-prices.ts
 *   npx tsx src/scripts/restore-wiped-product-prices.ts --apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/**
 * Восстанавливать всё подряд опасно: среди старых сделок попадаются опечатки
 * (лист мелованной бумаги за 14 000 при соседних 1 400), а цены 2024 года давно
 * не актуальны. Фильтры позволяют вернуть сначала то, что реально нужно витрине.
 *
 *   --only-active        только активные товары
 *   --since=2026-01-01   только продажи не старше даты
 *   --skip=sku1,sku2     пропустить конкретные артикулы (заведомо битые цены)
 */
const ONLY_ACTIVE = process.argv.includes('--only-active');

const SINCE = (() => {
  const arg = process.argv.find((a) => a.startsWith('--since='));
  if (!arg) return null;
  const date = new Date(arg.slice('--since='.length));
  return Number.isNaN(date.getTime()) ? null : date;
})();

const SKIP_SKUS = (() => {
  const arg = process.argv.find((a) => a.startsWith('--skip='));
  if (!arg) return new Set<string>();
  return new Set(arg.slice('--skip='.length).split(',').map((s) => s.trim()).filter(Boolean));
})();

type Candidate = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  isActive: boolean;
  salePrice: number | null;
  purchasePrice: number | null;
  /** Последняя цена, по которой товар реально продавали. */
  lastSoldPrice: number | null;
  lastSoldAt: Date | null;
  /** Последняя цена закупки из импортных заказов. */
  lastPurchasePrice: number | null;
};

function money(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('ru-RU');
}

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { OR: [{ salePrice: null }, { purchasePrice: null }] },
    select: {
      id: true, name: true, sku: true, unit: true, isActive: true,
      salePrice: true, purchasePrice: true,
    },
    orderBy: { name: 'asc' },
  });

  if (!products.length) {
    console.log('Товаров с пустой ценой нет — восстанавливать нечего.');
    return;
  }

  const candidates: Candidate[] = [];

  for (const p of products) {
    // Последняя ненулевая цена продажи из позиций сделок.
    const lastItem = await prisma.dealItem.findFirst({
      where: { productId: p.id, price: { not: null, gt: 0 } },
      orderBy: [{ dealDate: 'desc' }, { createdAt: 'desc' }],
      select: { price: true, dealDate: true, createdAt: true },
    });

    const lastImport = await prisma.importOrderItem.findFirst({
      where: { productId: p.id, unitPrice: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      select: { unitPrice: true },
    });

    candidates.push({
      id: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      isActive: p.isActive,
      salePrice: p.salePrice != null ? Number(p.salePrice) : null,
      purchasePrice: p.purchasePrice != null ? Number(p.purchasePrice) : null,
      lastSoldPrice: lastItem?.price != null ? Number(lastItem.price) : null,
      lastSoldAt: lastItem?.dealDate ?? lastItem?.createdAt ?? null,
      lastPurchasePrice: lastImport?.unitPrice != null ? Number(lastImport.unitPrice) : null,
    });
  }

  /** Товар проходит фильтры и его цену можно записывать. */
  const passesFilters = (c: Candidate): boolean => {
    if (SKIP_SKUS.has(c.sku)) return false;
    if (ONLY_ACTIVE && !c.isActive) return false;
    if (SINCE && (!c.lastSoldAt || c.lastSoldAt < SINCE)) return false;
    return true;
  };

  const restorableSale = candidates
    .filter((c) => c.salePrice == null && c.lastSoldPrice != null)
    .filter(passesFilters);
  const restorablePurchase = candidates
    .filter((c) => c.purchasePrice == null && c.lastPurchasePrice != null)
    .filter(passesFilters);
  const hopeless = candidates.filter(
    (c) => c.salePrice == null && c.lastSoldPrice == null,
  );

  const filters = [
    ONLY_ACTIVE ? 'только активные' : null,
    SINCE ? `продажи с ${SINCE.toISOString().slice(0, 10)}` : null,
    SKIP_SKUS.size ? `пропущено артикулов: ${SKIP_SKUS.size}` : null,
  ].filter(Boolean);
  if (filters.length) console.log(`Фильтры: ${filters.join(', ')}\n`);

  console.log(`Товаров с пустой ценой: ${candidates.length}`);
  console.log(`  можно восстановить цену продажи: ${restorableSale.length}`);
  console.log(`  можно восстановить цену закупки: ${restorablePurchase.length}`);
  console.log(`  нет данных о продажах — только вручную: ${hopeless.length}\n`);

  if (restorableSale.length) {
    console.log('── Цена продажи (по последней фактической продаже) ──');
    for (const c of restorableSale) {
      const when = c.lastSoldAt ? c.lastSoldAt.toISOString().slice(0, 10) : '—';
      const flag = c.isActive ? '' : ' [неактивен]';
      console.log(`  ${c.name} (${c.sku})${flag}: — → ${money(c.lastSoldPrice)} / ${c.unit}  [продан ${when}]`);
    }
    console.log('');
  }

  if (restorablePurchase.length) {
    console.log('── Цена закупки (по последнему импортному заказу) ──');
    for (const c of restorablePurchase) {
      console.log(`  ${c.name} (${c.sku}): — → ${money(c.lastPurchasePrice)} / ${c.unit}`);
    }
    console.log('');
  }

  if (hopeless.length) {
    console.log('── Восстановить автоматически нельзя (товар ни разу не продавался) ──');
    for (const c of hopeless) {
      const flag = c.isActive ? '' : ' [неактивен]';
      console.log(`  ${c.name} (${c.sku})${flag}`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('Это предпросмотр — БД не изменена. Записать: добавьте флаг --apply');
    return;
  }

  let updated = 0;
  for (const c of candidates) {
    // Пишем ровно то, что показали в предпросмотре, — фильтры те же
    if (!passesFilters(c)) continue;

    const data: { salePrice?: number; purchasePrice?: number } = {};
    if (c.salePrice == null && c.lastSoldPrice != null) data.salePrice = c.lastSoldPrice;
    if (c.purchasePrice == null && c.lastPurchasePrice != null) data.purchasePrice = c.lastPurchasePrice;
    if (!Object.keys(data).length) continue;

    await prisma.product.update({ where: { id: c.id }, data });
    updated += 1;
  }

  console.log(`Обновлено товаров: ${updated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
