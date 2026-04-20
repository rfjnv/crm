import client from './client';
import type { Expense, ExpenseMethod } from '../types';

export const expensesApi = {
  list: (params?: { from?: string; to?: string; category?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED'; method?: ExpenseMethod }) =>
    client.get<{ expenses: Expense[]; total: number }>('/expenses', { params }).then((r) => r.data),
  create: (data: { date: string; category: string; amount: number; note?: string; method?: ExpenseMethod }) =>
    client.post<Expense>('/expenses', data).then((r) => r.data),
  approve: (id: string) => client.patch<Expense>(`/expenses/${id}/approve`).then((r) => r.data),
  reject: (id: string, reason: string) => client.patch<Expense>(`/expenses/${id}/reject`, { reason }).then((r) => r.data),
  remove: (id: string) => client.delete(`/expenses/${id}`).then((r) => r.data),
};
