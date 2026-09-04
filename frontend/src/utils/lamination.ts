/**
 * Ламинационная плёнка продаётся по весу (кг), но клиенты заказывают и склад выдаёт её
 * рулонами — поэтому у товара есть второй, параллельный остаток `rollStock`, который
 * списывается вместе с килограммами при закрытии сделки.
 *
 * Количество рулонов передаётся числом в `DealItem.rollCount`. Разбор из текста
 * комментария оставлен только для позиций, созданных до появления этого поля:
 * тогда инпут рулонов писал значение в свободный комментарий строкой «N рул.».
 *
 * Зеркало backend/src/lib/lamination.ts — правила разбора обязаны совпадать, иначе
 * фронт и списание при закрытии увидят разное количество.
 */

export const LAMINATION_CATEGORY = 'Ламинационная пленка';

export function isLaminationProduct(product?: { category?: string | null } | null): boolean {
  return product?.category === LAMINATION_CATEGORY;
}

/**
 * Товар с рулонным учётом: категория ламинации И заведённый второй остаток.
 * `rollStock === null` — рулоны у товара не считаются, требовать их количество незачем.
 */
export function isRollTrackedProduct(
  product?: { category?: string | null; rollStock?: unknown } | null,
): boolean {
  return isLaminationProduct(product) && product?.rollStock != null;
}

/**
 * Первая позиция оверрайда, у которой рулонный товар отгружается без указанного кол-ва рулонов.
 * Без него бэкенд пересчитает килограммы, а рулонный остаток оставит прежним — так дважды
 * разъезжался склад при ЗАМЕНЕ товара в августе 2026.
 */
export function findItemMissingRollCount<T extends { productId?: string; requestedQty?: number; rollCount?: number }>(
  items: T[],
  productMap: Map<string, { name: string; category?: string | null; rollStock?: unknown }>,
): { item: T; productName: string } | null {
  for (const item of items) {
    if (!item.productId || !((item.requestedQty ?? 0) > 0)) continue;
    const product = productMap.get(item.productId);
    if (!isRollTrackedProduct(product)) continue;
    if (item.rollCount != null && item.rollCount > 0) continue;
    return { item, productName: product?.name ?? 'товар' };
  }
  return null;
}

/**
 * Достаёт количество рулонов из легаси-комментария позиции.
 * Число обязано стоять в НАЧАЛЕ строки — в том формате, который писал инпут («N рул.»),
 * иначе комментарий-пояснение вроде «заменили на 17 микрон» читался бы как 17 рулонов.
 */
export function parseRollCountFromComment(comment: string | null | undefined): number | undefined {
  const m = String(comment ?? '').match(/^\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return undefined;
  const value = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Количество рулонов позиции: числовое поле, иначе легаси-комментарий. */
export function resolveRollCount(
  item: { rollCount?: number | string | null; requestComment?: string | null },
): number | undefined {
  if (item.rollCount != null) {
    const n = Number(item.rollCount);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return parseRollCountFromComment(item.requestComment);
}
