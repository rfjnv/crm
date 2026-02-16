import client from './client';
import type { DebtsResponse, DayClosingResponse, DayClosingListResponse, DailyClosing, ClientDebtDetail } from '../types';

export const financeApi = {
  getDebts: () =>
    client.get<DebtsResponse>('/finance/debts').then((r) => r.data),

  getDayClosing: (date?: string) =>
    client.get<DayClosingResponse>('/finance/day-closing', { params: date ? { date } : {} }).then((r) => r.data),

  getDayClosings: () =>
    client.get<DayClosingListResponse>('/finance/day-closings').then((r) => r.data),

  closeDay: () =>
    client.post<DailyClosing>('/finance/close-day').then((r) => r.data),

  clientDebtDetail: (clientId: string) =>
    client.get<ClientDebtDetail>(`/finance/debts/client/${clientId}`).then((r) => r.data),
};
