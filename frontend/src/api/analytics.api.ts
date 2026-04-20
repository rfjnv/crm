import client from './client';
import type {
  AnalyticsData,
  IntelligenceData,
  HistoryData,
  HistoryExtendedData,
  HistoryDrilldownData,
  HistoryMonthDetail,
  HistoryClientMonthData,
  HistoryProductBuyersData,
  HistoryCashflowData,
  DataQualityData,
  ExchangeData,
  PrepaymentData,
  HistoryCohortClientsData,
  AbcXyzResponse,
} from '../types';

export type AnalyticsPeriod = 'week' | 'month' | 'quarter' | 'year';

/** Агрегаты по товару / категории для вкладки «Иерархия товаров» (без списка всех позиций). */
export type HierarchyMerchandiseStatsRow = {
  dealsCount: number;
  soldQty: number;
  salesRevenue: number;
  lastSaleAt: string;
};

export type HierarchyMerchandiseStats = {
  byProduct: Record<string, HierarchyMerchandiseStatsRow>;
  byCategory: Record<string, HierarchyMerchandiseStatsRow>;
};

/** Строка для «Клиенты по иерархии» — согласовано с аналитикой товара (CLOSED, отсечка по createdAt сделки). */
export type HierarchyClosedItemRow = {
  productId: string;
  dealId: string;
  dealTitle: string | null;
  clientId: string;
  clientName: string;
  clientIsSvip: boolean;
  soldQty: number;
  unitPrice: number;
  salesRevenue: number;
  dealCreatedAt: string;
  /** Дата закрытия сделки или, если нет, дата создания */
  saleAt: string;
};

export type CallActivityRange = 'today' | 'week' | 'month';

export type CallActivitySummaryRow = {
  userId: string;
  fullName: string;
  contactCount: number;
  lastActivityAt: string;
};

export type CallActivityResponse = {
  range: { key: CallActivityRange; start: string; end: string };
  summary: CallActivitySummaryRow[];
  lineChart: { day: string; manager: string; userId: string; count: number }[];
  barChart: { manager: string; userId: string; total: number }[];
  feed: {
    id: string;
    userId: string;
    managerName: string;
    clientId: string;
    companyName: string;
    preview: string;
    createdAt: string;
  }[];
};

export const analyticsApi = {
  getData: (period: AnalyticsPeriod = 'month') =>
    client.get<AnalyticsData>('/analytics', { params: { period } }).then((r) => r.data),

  getHierarchyClosedItems: (fromIso: string) =>
    client
      .get<{ rows: HierarchyClosedItemRow[] }>('/analytics/hierarchy-closed-items', {
        params: { from: fromIso },
      })
      .then((r) => r.data),

  getHierarchyMerchandiseStats: (fromIso: string) =>
    client
      .get<HierarchyMerchandiseStats>('/analytics/hierarchy-merchandise-stats', {
        params: { from: fromIso },
      })
      .then((r) => r.data),

  getCallActivity: (params: {
    range?: CallActivityRange;
    managerId?: string;
    clientSearch?: string;
  }) =>
    client.get<CallActivityResponse>('/analytics/call-activity', { params }).then((r) => r.data),

  getAbcXyz: (period: AnalyticsPeriod = 'month') =>
    client.get<AbcXyzResponse>('/analytics/abc-xyz', { params: { period } }).then((r) => r.data),
  getIntelligence: (period: AnalyticsPeriod = 'month') =>
    client.get<IntelligenceData>('/analytics/intelligence', { params: { period } }).then((r) => r.data),
  getHistory: (year: number = new Date().getFullYear()) =>
    client.get<HistoryData>('/analytics/history', { params: { year } }).then((r) => r.data),
  getHistoryExtended: (year: number = new Date().getFullYear()) =>
    client.get<HistoryExtendedData>('/analytics/history/extended', { params: { year } }).then((r) => r.data),
  getHistoryDrilldown: (type: string, filters?: { managerId?: string; method?: string }, year: number = new Date().getFullYear()) =>
    client.get<HistoryDrilldownData>('/analytics/history/drilldown', { params: { type, ...filters, year } }).then((r) => r.data),
  getHistoryMonth: (month: number, year: number = new Date().getFullYear()) =>
    client.get<HistoryMonthDetail>(`/analytics/history/month/${month}`, { params: { year } }).then((r) => r.data),
  getHistoryClientMonth: (clientId: string, month: number, year: number = new Date().getFullYear()) =>
    client.get<HistoryClientMonthData>(`/analytics/history/client-month/${clientId}/${month}`, { params: { year } }).then((r) => r.data),
  getHistoryCohortClients: (cohortMonth: number, activeMonth: number, year: number = new Date().getFullYear()) =>
    client.get<HistoryCohortClientsData>(`/analytics/history/cohort-clients/${cohortMonth}/${activeMonth}`, { params: { year } }).then((r) => r.data),
  getHistoryProductBuyers: (productId: string, year: number = new Date().getFullYear()) =>
    client.get<HistoryProductBuyersData>(`/analytics/history/product-buyers/${productId}`, { params: { year } }).then((r) => r.data),
  getHistoryCashflow: (year: number = new Date().getFullYear()) =>
    client.get<HistoryCashflowData>('/analytics/history/cashflow', { params: { year } }).then((r) => r.data),
  getHistoryDataQuality: (year: number = new Date().getFullYear()) =>
    client.get<DataQualityData>('/analytics/history/data-quality', { params: { year } }).then((r) => r.data),
  getHistoryExchange: (year: number = new Date().getFullYear()) =>
    client.get<ExchangeData>('/analytics/history/exchange', { params: { year } }).then((r) => r.data),
  getHistoryPrepayments: (year: number = new Date().getFullYear()) =>
    client.get<PrepaymentData>('/analytics/history/prepayments', { params: { year } }).then((r) => r.data),
  exportDebtBreakdown: (year: number = new Date().getFullYear()) =>
    client.get('/analytics/history/export/debt-breakdown', {
      params: { year },
      responseType: 'blob',
    }).then((r) => {
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `debt-breakdown-${year}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    }),

  exportClosedDeals: (from: string, to: string) =>
    client.get('/analytics/export/closed-deals.xlsx', {
      params: { from, to },
      responseType: 'blob',
    }).then((r) => {
      const header = String(r.headers?.['content-disposition'] || '');
      const match = /filename="([^"]+)"/i.exec(header);
      const fallback = `closed-deals-${from}_${to}.xlsx`;
      const filename = match?.[1] || fallback;
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    }),

  sendClosedDealsNow: () =>
    client.post('/analytics/export/closed-deals/send-now').then((r) => r.data as {
      ok: boolean;
      period: { from: string; to: string };
      rows: number;
      sentAt: string;
      errors?: string[];
    }),
};
