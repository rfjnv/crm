import { analyticsApi } from '../api/analytics.api';
import type { AnalyticsPeriod } from '../api/analytics.api';
import type { Product } from '../types';

export type ProductSalesAggregate = {
  productId: string;
  soldQty: number;
  salesRevenue: number;
  /** Число сделок с этим товаром; при суммировании по нескольким товарам одна сделка может считаться несколько раз */
  dealsCount: number;
  lastSaleAt: string | null;
};

export type ProductPurchaseRow = {
  productId: string;
  dealId: string;
  dealTitle: string;
  clientId: string;
  clientName: string;
  clientIsSvip: boolean;
  soldQty: number;
  salesRevenue: number;
  /** Дата продажи (закрытие сделки или создание) */
  saleAt: string;
};

export type HierarchyPeriodPreset = AnalyticsPeriod | 'custom';

export function safePrice(value?: string | null): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export function inferTypeLabel(product: Product): string {
  const specs = product.specifications;
  if (specs && typeof specs === 'object') {
    const typeFromSpecs = (specs as Record<string, unknown>).type;
    if (typeof typeFromSpecs === 'string' && typeFromSpecs.trim()) {
      return typeFromSpecs.trim();
    }
  }

  let cleaned = product.name || '';
  if (product.format) {
    const escapedFormat = product.format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escapedFormat, 'ig'), ' ');
  }

  cleaned = cleaned
    .replace(/\b\d+\s*[xх*]\s*\d+(\s*[xх*]\s*\d+)?\b/gi, ' ')
    .replace(/\b\d+\s*(мкм|мм|см|cm|mm)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const firstChunk = cleaned.split(/[-–—/:(),]/)[0]?.trim();
  return firstChunk || cleaned || 'Без типа';
}

export function getPeriodStartDate(period: AnalyticsPeriod): Date {
  const now = new Date();
  const start = new Date(now);
  if (period === 'week') {
    start.setDate(now.getDate() - 7);
    return start;
  }
  if (period === 'month') {
    start.setDate(now.getDate() - 30);
    return start;
  }
  if (period === 'quarter') {
    start.setDate(now.getDate() - 90);
    return start;
  }
  /** Как на странице товара: «Год» = последние 365 дней */
  start.setDate(now.getDate() - 365);
  return start;
}

export function getStartDateByPreset(preset: HierarchyPeriodPreset, customDays: number): Date {
  if (preset === 'custom') {
    const safeDays = Number.isFinite(customDays) ? Math.max(1, Math.floor(customDays)) : 30;
    const start = new Date();
    start.setDate(start.getDate() - safeDays);
    return start;
  }
  return getPeriodStartDate(preset);
}

export async function loadHierarchyMerchandiseStats(periodStart: Date) {
  return analyticsApi.getHierarchyMerchandiseStats(periodStart.toISOString());
}

type AggBuilder = {
  productId: string;
  soldQty: number;
  salesRevenue: number;
  dealIds: Set<string>;
  lastSaleAt: string | null;
};

export async function loadSalesContext(periodStart: Date) {
  const { rows } = await analyticsApi.getHierarchyClosedItems(periodStart.toISOString());

  const building: Record<string, AggBuilder> = {};
  const purchaseRows: ProductPurchaseRow[] = [];

  for (const row of rows) {
    const qty = row.soldQty;
    if (qty <= 0) continue;

    if (!building[row.productId]) {
      building[row.productId] = {
        productId: row.productId,
        soldQty: 0,
        salesRevenue: 0,
        dealIds: new Set<string>(),
        lastSaleAt: null,
      };
    }

    const current = building[row.productId];
    current.soldQty += qty;
    current.salesRevenue += row.salesRevenue;
    current.dealIds.add(row.dealId);
    if (!current.lastSaleAt || new Date(row.saleAt) > new Date(current.lastSaleAt)) {
      current.lastSaleAt = row.saleAt;
    }

    purchaseRows.push({
      productId: row.productId,
      dealId: row.dealId,
      dealTitle: row.dealTitle?.trim() || `Сделка ${row.dealId.slice(0, 6)}`,
      clientId: row.clientId,
      clientName: row.clientName || 'Клиент',
      clientIsSvip: row.clientIsSvip,
      soldQty: qty,
      salesRevenue: row.salesRevenue,
      saleAt: row.saleAt,
    });
  }

  const aggregateMap: Record<string, ProductSalesAggregate> = {};
  for (const [id, b] of Object.entries(building)) {
    aggregateMap[id] = {
      productId: id,
      soldQty: b.soldQty,
      salesRevenue: b.salesRevenue,
      dealsCount: b.dealIds.size,
      lastSaleAt: b.lastSaleAt,
    };
  }

  return { aggregateMap, purchaseRows };
}
