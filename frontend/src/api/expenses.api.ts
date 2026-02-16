import client from './client';
import type { Expense } from '../types';

export const expensesApi = {
  list: (params?: { from?: string; to?: string; category?: string }) =>
    client.get<{ expenses: Expense[]; total: number }>('/expenses', { params }).then((r) => r.data),
  create: (data: { date: string; category: string; amount: number; note?: string }) =>
    client.post<Expense>('/expenses', data).then((r) => r.data),
  remove: (id: string) => client.delete(`/expenses/${id}`).then((r) => r.data),
};
