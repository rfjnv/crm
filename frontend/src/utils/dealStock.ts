import type { DealItem } from '../types';

/** Позиция ждёт количество от склада (менеджер не указал или ≤ 0). */
export function dealItemNeedsWarehouseStock(item: Pick<DealItem, 'requestedQty'>): boolean {
  if (item.requestedQty == null) return true;
  const n = Number(item.requestedQty);
  return !Number.isFinite(n) || n <= 0;
}
