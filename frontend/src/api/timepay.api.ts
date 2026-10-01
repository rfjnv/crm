import client from './client';
import type { TimePayStatus, TimePaySyncResult, TimePayUnmatchedResult } from '../types';

export const timepayApi = {
  getStatus: () => client.get<TimePayStatus>('/timepay/status').then((r) => r.data),
  setToken: (accessToken: string) => client.put<TimePayStatus>('/timepay/token', { accessToken }).then((r) => r.data),
  unmatched: (date?: string) =>
    client.get<TimePayUnmatchedResult>('/timepay/unmatched', { params: date ? { date } : undefined }).then((r) => r.data),
  sync: (date?: string) => client.post<TimePaySyncResult>('/timepay/sync', undefined, { params: date ? { date } : undefined }).then((r) => r.data),
};
