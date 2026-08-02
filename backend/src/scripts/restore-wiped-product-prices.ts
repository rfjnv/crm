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

  const restorableSale = candidates.filter((c) => c.salePrice == null && c.lastSoldPrice != null);
  const restorablePurchase = candidates.filter((c) => c.purchasePrice == null && c.lastPurchasePrice != null);
  const hopeless = candidates.filter(
    (c) => c.salePrice == null && c.lastSoldPrice == null,
  );

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
