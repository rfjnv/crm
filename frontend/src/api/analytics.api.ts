import client from './client';
import type { AnalyticsData } from '../types';

export type AnalyticsPeriod = 'week' | 'month' | 'quarter' | 'year';

export const analyticsApi = {
  getData: (period: AnalyticsPeriod = 'month') =>
    client.get<AnalyticsData>('/analytics', { params: { period } }).then((r) => r.data),
};
