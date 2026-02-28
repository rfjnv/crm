import client from './client';
import type { AnalyticsData, IntelligenceData, HistoryData, HistoryExtendedData, HistoryDrilldownData, HistoryMonthDetail, HistoryClientMonthData, HistoryProductBuyersData, HistoryCashflowData } from '../types';

export type AnalyticsPeriod = 'week' | 'month' | 'quarter' | 'year';

export const analyticsApi = {
  getData: (period: AnalyticsPeriod = 'month') =>
    client.get<AnalyticsData>('/analytics', { params: { period } }).then((r) => r.data),
  getIntelligence: (period: AnalyticsPeriod = 'month') =>
    client.get<IntelligenceData>('/analytics/intelligence', { params: { period } }).then((r) => r.data),
  getHistory: () =>
    client.get<HistoryData>('/analytics/history').then((r) => r.data),
  getHistoryExtended: () =>
    client.get<HistoryExtendedData>('/analytics/history/extended').then((r) => r.data),
  getHistoryDrilldown: (type: string, filters?: { managerId?: string; method?: string }) =>
    client.get<HistoryDrilldownData>('/analytics/history/drilldown', { params: { type, ...filters } }).then((r) => r.data),
  getHistoryMonth: (month: number) =>
    client.get<HistoryMonthDetail>(`/analytics/history/month/${month}`).then((r) => r.data),
  getHistoryClientMonth: (clientId: string, month: number) =>
    client.get<HistoryClientMonthData>(`/analytics/history/client-month/${clientId}/${month}`).then((r) => r.data),
  getHistoryProductBuyers: (productId: string) =>
    client.get<HistoryProductBuyersData>(`/analytics/history/product-buyers/${productId}`).then((r) => r.data),
  getHistoryCashflow: () =>
    client.get<HistoryCashflowData>('/analytics/history/cashflow').then((r) => r.data),
};
