import client from './client';
import type { Client, AuditLog, PaymentRecord, ClientAnalytics } from '../types';

export interface CreateClientData {
  companyName: string;
  contactName: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  managerId?: string;
}

export const clientsApi = {
  list: () => client.get<Client[]>('/clients').then((r) => r.data),

  getById: (id: string, params?: { dealStatus?: string; from?: string; to?: string }) =>
    client.get<Client>(`/clients/${id}`, { params }).then((r) => r.data),

  create: (data: CreateClientData) => client.post<Client>('/clients', data).then((r) => r.data),

  update: (id: string, data: Partial<CreateClientData>) =>
    client.patch<Client>(`/clients/${id}`, data).then((r) => r.data),

  archive: (id: string) => client.patch<Client>(`/clients/${id}/archive`).then((r) => r.data),

  history: (id: string) => client.get<AuditLog[]>(`/clients/${id}/history`).then((r) => r.data),

  payments: (id: string) => client.get<PaymentRecord[]>(`/clients/${id}/payments`).then((r) => r.data),

  analytics: (id: string, periodDays?: number) =>
    client.get<ClientAnalytics>(`/clients/${id}/analytics`, { params: periodDays ? { periodDays } : {} }).then((r) => r.data),
};
