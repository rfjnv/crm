import client from './client';
import type { Contract, ContractListItem, ContractDetail, ContractAttachment } from '../types';

export const contractsApi = {
  list: (clientId?: string) =>
    client.get<ContractListItem[]>('/contracts', { params: clientId ? { clientId } : {} }).then((r) => r.data),

  getById: (id: string) => client.get<ContractDetail>(`/contracts/${id}`).then((r) => r.data),

  create: (data: { clientId: string; contractNumber: string; amount?: number; startDate: string; endDate?: string; notes?: string }) =>
    client.post<Contract>('/contracts', data).then((r) => r.data),

  update: (id: string, data: Partial<{ contractNumber: string; amount: number; startDate: string; endDate: string | null; isActive: boolean; notes: string | null }>) =>
    client.patch<Contract>(`/contracts/${id}`, data).then((r) => r.data),

  uploadAttachment: (contractId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post<ContractAttachment>(`/contracts/${contractId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  deleteAttachment: (contractId: string, attachmentId: string) =>
    client.delete(`/contracts/${contractId}/attachments/${attachmentId}`).then((r) => r.data),
};
