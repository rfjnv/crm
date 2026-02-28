import client from './client';
import type { AnalyticsData, IntelligenceData, HistoryData, HistoryExtendedData, HistoryDrilldownData, HistoryMonthDetail, HistoryClientMonthData, HistoryProductBuyersData, HistoryCashflowData, DataQualityData, ExchangeData, PrepaymentData } from '../types';

export type AnalyticsPeriod = 'week' | 'month' | 'quarter' | 'year';

export const analyticsApi = {
  getData: (period: AnalyticsPeriod = 'month') =>
    client.get<AnalyticsData>('/analytics', { params: { period } }).then((r) => r.data),
  getIntelligence: (period: AnalyticsPeriod = 'month') =>
    client.get<IntelligenceData>('/analytics/intelligence', { params: { period } }).then((r) => r.data),
  getHistory: (year: number = 2025) =>
    client.get<HistoryData>('/analytics/history', { params: { year } }).then((r) => r.data),
  getHistoryExtended: (year: number = 2025) =>
    client.get<HistoryExtendedData>('/analytics/history/extended', { params: { year } }).then((r) => r.data),
  getHistoryDrilldown: (type: string, filters?: { managerId?: string; method?: string }, year: number = 2025) =>
    client.get<HistoryDrilldownData>('/analytics/history/drilldown', { params: { type, ...filters, year } }).then((r) => r.data),
  getHistoryMonth: (month: number, year: number = 2025) =>
    client.get<HistoryMonthDetail>(`/analytics/history/month/${month}`, { params: { year } }).then((r) => r.data),
  getHistoryClientMonth: (clientId: string, month: number, year: number = 2025) =>
    client.get<HistoryClientMonthData>(`/analytics/history/client-month/${clientId}/${month}`, { params: { year } }).then((r) => r.data),
  getHistoryProductBuyers: (productId: string, year: number = 2025) =>
    client.get<HistoryProductBuyersData>(`/analytics/history/product-buyers/${productId}`, { params: { year } }).then((r) => r.data),
  getHistoryCashflow: (year: number = 2025) =>
    client.get<HistoryCashflowData>('/analytics/history/cashflow', { params: { year } }).then((r) => r.data),
  getHistoryDataQuality: (year: number = 2025) =>
    client.get<DataQualityData>('/analytics/history/data-quality', { params: { year } }).then((r) => r.data),
  getHistoryExchange: (year: number = 2025) =>
    client.get<ExchangeData>('/analytics/history/exchange', { params: { year } }).then((r) => r.data),
  getHistoryPrepayments: (year: number = 2025) =>
    client.get<PrepaymentData>('/analytics/history/prepayments', { params: { year } }).then((r) => r.data),
};
