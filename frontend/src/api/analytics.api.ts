import client from './client';
import type { AnalyticsData, IntelligenceData, HistoryData, HistoryExtendedData, HistoryDrilldownData, HistoryMonthDetail, HistoryClientMonthData, HistoryProductBuyersData, HistoryCashflowData, DataQualityData, ExchangeData, PrepaymentData } from '../types';

export type AnalyticsPeriod = 'week' | 'month' | 'quarter' | 'year';

export const analyticsApi = {
  getData: (period: AnalyticsPeriod = 'month') =>
    client.get<AnalyticsData>('/analytics', { params: { period } }).then((r) => r.data),
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
};
