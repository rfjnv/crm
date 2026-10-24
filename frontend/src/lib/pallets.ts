import type { Product } from '../types';

/** Сколько листов самоклеющейся бумаги в одном палете, по формату листа. */
export const SHEETS_PER_PALLET: Record<string, number> = {
  '50×35': 20_800,
  '50×70': 10_400,
  '70×100': 5_200,
};

/** Порядок форматов в сводке — от мелкого листа к крупному. */
export const PALLET_FORMATS = Object.keys(SHEETS_PER_PALLET);

/**
 * Формат листа самоклейки («50×35», «50×70», «70×100») или null, если товар — не самоклейка
 * в листах (рулоны и прочее на палеты не пересчитываем). Формат ищем в поле format и в названии:
 * пишут и «70*100», и «70x100», и «70х100».
 */
export function palletFormatOf(product: Pick<Product, 'name' | 'category' | 'format' | 'unit'> | undefined): string | null {
  if (!product) return null;
  const text = `${product.category ?? ''} ${product.name}`.toLowerCase();
  if (!text.includes('самокле')) return null;
  if (/рул/.test(`${product.unit ?? ''} ${product.name}`.toLowerCase())) return null;
  const source = `${product.format ?? ''} ${product.name}`;
  const m = source.match(/(\d{2,3})\s*[*xх×]\s*(\d{2,3})/i);
  if (!m) return null;
  const key = `${m[1]}×${m[2]}`;
  return key in SHEETS_PER_PALLET ? key : null;
}

export function sheetsPerPalletOf(product: Parameters<typeof palletFormatOf>[0]): number | null {
  const format = palletFormatOf(product);
  return format ? SHEETS_PER_PALLET[format] : null;
}

/** «2,5 пал.» — до двух знаков, без хвостовых нулей. */
export function formatPallets(pallets: number): string {
  return `${pallets.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} пал.`;
}
