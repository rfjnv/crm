/**
 * Выгрузка складского остатка в CSV.
 *
 * Рулоны и вес разнесены по разным колонкам: у товаров с параллельным учётом
 * (ламинационная плёнка) рулоны идут в свою колонку, кг — в свою; у остальных
 * колонка рулонов пустая.
 */

import dayjs from 'dayjs';
import { downloadCsv } from './csv';
import type { Product } from '../types';

/** Excel в русской локали читает запятую как десятичный разделитель. */
function csvNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const s = Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
  return s.replace('.', ',');
}

export function exportProductsStock(
  products: Product[],
  opts: { includePurchasePrice?: boolean } = {},
): void {
  const { includePurchasePrice = false } = opts;

  const headers = [
    'Артикул', 'Название', 'Категория', 'Формат', 'Страна', 'Ед. изм.',
    'Остаток (рулоны)', 'Остаток (кг/ед.)', 'Забронировано', 'Мин. остаток',
    ...(includePurchasePrice ? ['Цена закупки'] : []),
    'Цена продажи', 'Статус',
  ];

  const rows = products.map((p) => [
    p.sku ?? '',
    p.name,
    p.category ?? '',
    p.format ?? '',
    p.countryOfOrigin ?? '',
    p.unit,
    p.rollStock == null ? '' : csvNumber(p.rollStock),
    csvNumber(p.stock),
    csvNumber(p.reservedQty ?? 0),
    csvNumber(p.minStock),
    ...(includePurchasePrice ? [csvNumber(p.purchasePrice)] : []),
    csvNumber(p.salePrice),
    p.isActive ? 'Активен' : 'Неактивен',
  ]);

  downloadCsv(`Остаток_${dayjs().format('YYYY-MM-DD')}.csv`, headers, rows);
}
