import { dealsApi } from '../api/deals.api';
import type { AnalyticsPeriod } from '../api/analytics.api';
import type { Product } from '../types';

export type ProductSalesAggregate = {
  productId: string;
  soldQty: number;
  salesRevenue: number;
  dealIds: Set<string>;
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
    start.setMonth(now.getMonth() - 1);
    return start;
  }
  if (period === 'quarter') {
    start.setMonth(now.getMonth() - 3);
    return start;
  }
  start.setFullYear(now.getFullYear() - 1);
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

export async function loadSalesContext(periodStart: Date) {
  const allDeals = await dealsApi.list(undefined, true);
  const closedDeals = allDeals.filter((deal) => {
    if (deal.status !== 'CLOSED') return false;
    const createdAt = new Date(deal.createdAt);
    return createdAt >= periodStart;
  });

  const dealItemsEntries = await Promise.all(
    closedDeals.map(async (deal) => {
      try {
        const items = await dealsApi.getItems(deal.id);
        return { dealId: deal.id, createdAt: deal.createdAt, items };
      } catch {
        return { dealId: deal.id, createdAt: deal.createdAt, items: [] };
      }
    }),
  );

  const aggregateMap: Record<string, ProductSalesAggregate> = {};
  const purchaseRows: ProductPurchaseRow[] = [];
  const dealsById = new Map(closedDeals.map((deal) => [deal.id, deal]));

  for (const entry of dealItemsEntries) {
    for (const item of entry.items) {
      if (!item.productId) continue;
      const qty = Number(item.requestedQty || 0);
      const price = Number(item.price || 0);
      if (qty <= 0 || price <= 0) continue;

      if (!aggregateMap[item.productId]) {
        aggregateMap[item.productId] = {
          productId: item.productId,
          soldQty: 0,
          salesRevenue: 0,
          dealIds: new Set<string>(),
          lastSaleAt: null,
        };
      }

      const current = aggregateMap[item.productId];
      current.soldQty += qty;
      current.salesRevenue += qty * price;
      current.dealIds.add(entry.dealId);
      if (!current.lastSaleAt || new Date(entry.createdAt) > new Date(current.lastSaleAt)) {
        current.lastSaleAt = entry.createdAt;
      }

      const deal = dealsById.get(entry.dealId);
      if (deal?.clientId) {
        purchaseRows.push({
          productId: item.productId,
          dealId: entry.dealId,
          dealTitle: deal.title || `Сделка ${entry.dealId.slice(0, 6)}`,
          clientId: deal.clientId,
          clientName: deal.client?.companyName || 'Клиент',
          clientIsSvip: Boolean(deal.client?.isSvip),
          soldQty: qty,
          salesRevenue: qty * price,
        });
      }
    }
  }

  return { aggregateMap, purchaseRows };
}
