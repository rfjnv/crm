import client from './client';
import type { Expense } from '../types';

export const expensesApi = {
  list: (params?: { from?: string; to?: string; category?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' }) =>
    client.get<{ expenses: Expense[]; total: number }>('/expenses', { params }).then((r) => r.data),
  create: (data: {
    date: string;
    category: string;
    amount: number;
    note?: string;
    method?: string;
    currency?: string;
    importOrderId?: string | null;
  }) =>
    client.post<Expense>('/expenses', data).then((r) => r.data),
  approve: (id: string) => client.patch<Expense>(`/expenses/${id}/approve`).then((r) => r.data),
  reject: (id: string, reason: string) => client.patch<Expense>(`/expenses/${id}/reject`, { reason }).then((r) => r.data),
  remove: (id: string) => client.delete(`/expenses/${id}`).then((r) => r.data),
};
