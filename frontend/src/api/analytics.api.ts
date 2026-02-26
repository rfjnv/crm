import client from './client';
import type { AnalyticsData, IntelligenceData, HistoryData } from '../types';

export type AnalyticsPeriod = 'week' | 'month' | 'quarter' | 'year';

export const analyticsApi = {
  getData: (period: AnalyticsPeriod = 'month') =>
    client.get<AnalyticsData>('/analytics', { params: { period } }).then((r) => r.data),
  getIntelligence: (period: AnalyticsPeriod = 'month') =>
    client.get<IntelligenceData>('/analytics/intelligence', { params: { period } }).then((r) => r.data),
  getHistory: () =>
    client.get<HistoryData>('/analytics/history').then((r) => r.data),
};
