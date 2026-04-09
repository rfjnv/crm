import client from './client';
import type { Client, AuditLog, PaymentRecord, ClientAnalytics, ClientNote } from '../types';

export interface CreateClientData {
  companyName: string;
  contactName: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  managerId?: string;
  inn?: string;
  bankName?: string;
  bankAccount?: string;
  mfo?: string;
  vatRegCode?: string;
  oked?: string;
  portraitProfile?: string;
  portraitGoals?: string;
  portraitPains?: string;
  portraitFears?: string;
  portraitObjections?: string;
}

export const clientsApi = {
  list: () => client.get<Client[]>('/clients').then((r) => r.data),

  getById: (id: string, params?: { dealStatus?: string; from?: string; to?: string }) =>
    client.get<Client>(`/clients/${id}`, { params }).then((r) => r.data),

  create: (data: CreateClientData) => client.post<Client>('/clients', data).then((r) => r.data),

  update: (id: string, data: Partial<CreateClientData>) =>
    client.patch<Client>(`/clients/${id}`, data).then((r) => r.data),

  archive: (id: string) => client.patch<Client>(`/clients/${id}/archive`).then((r) => r.data),

  toggleSvip: (id: string) => client.patch<Client>(`/clients/${id}/svip`).then((r) => r.data),

  history: (id: string) => client.get<AuditLog[]>(`/clients/${id}/history`).then((r) => r.data),

  payments: (id: string) => client.get<PaymentRecord[]>(`/clients/${id}/payments`).then((r) => r.data),

  analytics: (id: string, periodDays?: number) =>
    client.get<ClientAnalytics>(`/clients/${id}/analytics`, { params: periodDays ? { periodDays } : {} }).then((r) => r.data),

  notes: {
    list: (clientId: string, opts?: { includeDeleted?: boolean }) =>
      client
        .get<ClientNote[]>(`/clients/${clientId}/notes`, {
          params: opts?.includeDeleted ? { includeDeleted: 'true' } : {},
        })
        .then((r) => r.data),

    create: (clientId: string, data: { content: string }) =>
      client.post<ClientNote>(`/clients/${clientId}/notes`, data).then((r) => r.data),

    update: (clientId: string, noteId: string, data: { content: string }) =>
      client.patch<ClientNote>(`/clients/${clientId}/notes/${noteId}`, data).then((r) => r.data),

    delete: (clientId: string, noteId: string) =>
      client.delete<ClientNote>(`/clients/${clientId}/notes/${noteId}`).then((r) => r.data),

    restore: (clientId: string, noteId: string) =>
      client.post<ClientNote>(`/clients/${clientId}/notes/${noteId}/restore`).then((r) => r.data),
  },
};
