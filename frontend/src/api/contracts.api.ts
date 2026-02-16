import client from './client';
import type { Contract } from '../types';

export const contractsApi = {
  list: (clientId?: string) =>
    client.get<Contract[]>('/contracts', { params: clientId ? { clientId } : {} }).then((r) => r.data),

  getById: (id: string) => client.get<Contract>(`/contracts/${id}`).then((r) => r.data),

  create: (data: { clientId: string; contractNumber: string; startDate: string; endDate?: string; notes?: string }) =>
    client.post<Contract>('/contracts', data).then((r) => r.data),

  update: (id: string, data: Partial<{ contractNumber: string; startDate: string; endDate: string | null; isActive: boolean; notes: string | null }>) =>
    client.patch<Contract>(`/contracts/${id}`, data).then((r) => r.data),
};
