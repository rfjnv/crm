import client from './client';
import type { AnalyticsData, IntelligenceData, HistoryData, HistoryExtendedData, HistoryDrilldownData, HistoryMonthDetail } from '../types';

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
  getHistoryDrilldown: (type: string) =>
    client.get<HistoryDrilldownData>('/analytics/history/drilldown', { params: { type } }).then((r) => r.data),
  getHistoryMonth: (month: number) =>
    client.get<HistoryMonthDetail>(`/analytics/history/month/${month}`).then((r) => r.data),
};
