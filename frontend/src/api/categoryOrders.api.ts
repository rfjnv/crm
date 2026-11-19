import client from './client';
import type { CategoryScope } from './categoryAnalysis.api';

/** Заказы и продажи по категориям (backend category-orders.routes). */

export interface CatOrdersMonth {
  month: string;
  rev: number;
  qty: number;
  deals: number;
  clients: number;
  inQty: number;
  orderedQty: number;
  stock: number | null;
}

export interface RestockEvent {
  kind: 'arrival' | 'import';
  month: string;
  date: string;
  qty: number;
  number?: string;
  status?: string;
  eta?: string | null;
  baseline: number;
  before: number;
  after: number | null;
  dropBefore: number | null;
  recovery: number | null;
  stockBefore: number | null;
  dipped: boolean;
  stockedOut: boolean;
}

export interface CatOrdersCategory {
  name: string;
  unit: string | null;
  rev: number;
  deals: number;
  inQty: number;
  orderedQty: number;
  stock: number | null;
  monthly: number[];
  last3: number;
  prev3: number;
  trend: number | null;
  restocks: number;
  dipsBeforeRestock: number;
  lastRestock: RestockEvent | null;
}

export interface CatOrdersProduct {
  id: string;
  name: string;
  unit: string;
  stock: number;
  rev: number;
  last3: number;
  prev3: number;
  trend: number | null;
  months: { month: string; rev: number; qty: number; inQty: number; stock: number | null }[];
}

export interface CatOrdersResponse {
  from: string;
  to: string;
  current: string;
  scope: CategoryScope;
  months: string[];
  totals: { month: string; rev: number; deals: number; clients: number; arrivalCategories: number; orderCategories: number }[];
  categories: CatOrdersCategory[];
  detail: {
    name: string;
    unit: string | null;
    months: CatOrdersMonth[];
    events: RestockEvent[];
    products: CatOrdersProduct[];
  } | null;
}

export const categoryOrdersApi = {
  get: (p: { months: number; scope: CategoryScope; category?: string | null }) =>
    client
      .get<CatOrdersResponse>('/analytics/category-orders', {
        params: { months: p.months, scope: p.scope, category: p.category || undefined },
      })
      .then((r) => r.data),
};
