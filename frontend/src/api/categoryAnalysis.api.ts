import client from './client';

/** Анализ категорий: период против того же периода год назад (backend category-analysis.routes). */

export type CategoryPeriod = 'ytd' | 'r12' | 'custom';

export interface CategoryTotals {
  rev: number; revPrev: number; revChange: number | null;
  orders: number; ordersPrev: number;
  clients: number; clientsPrev: number;
  products: number; productsPrev: number;
  avgOrder: number; avgOrderPrev: number;
  newClients: number; revNew: number; lostClients: number; revLost: number;
}

export interface CategoryRow extends CategoryTotals {
  name: string;
  share: number;
  outOfStock: number;
  lostToStockout: number;
}

export type StockStatus = 'out' | 'low' | 'ok' | 'over' | 'dead' | 'none';

export interface CategoryProductRow {
  id: string; name: string; sku: string; unit: string; category: string;
  rev: number; revPrev: number; revChange: number | null;
  qty: number; qtyPrev: number;
  price: number | null; pricePrev: number | null; priceChange: number | null;
  clients: number; clientsPrev: number; orders: number; ordersPrev: number;
  share: number;
  abc: 'A' | 'B' | 'C' | null;
  xyz: 'X' | 'Y' | 'Z' | 'NEW' | null;
  cv: number | null;
  volumeEffect: number; priceEffect: number;
  stock: number; minStock: number;
  avgMonthlyQty: number;
  coverMonths: number | null;
  stockStatus: StockStatus;
  lastSale: string | null;
  monthly: number[];
}

export type CategoryClientStatus = 'new' | 'lost' | 'up' | 'down' | 'flat';

export interface CategoryClientRow {
  id: string; name: string;
  rev: number; revPrev: number; revChange: number | null;
  orders: number; ordersPrev: number;
  products: number;
  lastBuy: string | null;
  status: CategoryClientStatus;
  managerId: string; managerName: string;
  own: boolean;
}

export interface CategoryManagerRow {
  id: string; name: string;
  rev: number; revPrev: number; revChange: number | null;
  clients: number; clientsPrev: number;
  orders: number;
}

export interface CategoryClientProductRow {
  clientId: string;
  productId: string;
  qty: number; qtyPrev: number;
  rev: number; revPrev: number;
  orders: number;
  lastBuy: string | null;
}

export interface CategoryAnalysisResponse {
  today: string;
  category: string | null;
  excludeOwn: boolean;
  periods: { kind: CategoryPeriod; cur: { from: string; to: string }; prev: { from: string; to: string } };
  months: string[];
  curMonths: string[];
  totals: CategoryTotals;
  categories: CategoryRow[];
  monthly: { month: string; key: string; rev: number }[];
  products: CategoryProductRow[];
  clients: CategoryClientRow[];
  managers: CategoryManagerRow[];
  /** Кто что купил — только внутри категории. */
  clientProducts: CategoryClientProductRow[];
  priceVolume: { volume: number; price: number; added: number; dropped: number };
  productNames?: Record<string, string>;
}

export interface CategoryAnalysisParams {
  period: CategoryPeriod;
  from?: string;
  to?: string;
  category?: string | null;
  excludeOwn: boolean;
}

export const categoryAnalysisApi = {
  get: (p: CategoryAnalysisParams) =>
    client
      .get<CategoryAnalysisResponse>('/analytics/category-analysis', {
        params: {
          period: p.period,
          from: p.period === 'custom' ? p.from : undefined,
          to: p.period === 'custom' ? p.to : undefined,
          category: p.category || undefined,
          excludeOwn: String(p.excludeOwn),
        },
      })
      .then((r) => r.data),
};
