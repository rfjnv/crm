import client from './client';
import type { Contract, ContractListItem, ContractDetail, ContractAttachment, ContractType } from '../types';
import { downloadBlob, getFilenameFromDisposition } from '../utils/download';

const PRINT_FILENAME_BY_DOC: Record<string, string> = {
  CONTRACT: 'contract',
  CONTRACT_ANNUAL: 'contract',
  CONTRACT_ONE_TIME: 'contract',
  SPECIFICATION: 'specification',
  INVOICE: 'invoice',
  POWER_OF_ATTORNEY: 'power-of-attorney',
  PACKAGE: 'contract-package',
};

export const contractsApi = {
  list: (clientId?: string) =>
    client.get<ContractListItem[]>('/contracts', { params: clientId ? { clientId } : {} }).then((r) => r.data),

  getById: (id: string) => client.get<ContractDetail>(`/contracts/${id}`).then((r) => r.data),

  create: (data: { clientId: string; contractNumber: string; contractType?: ContractType; amount?: number; startDate: string; endDate?: string; notes?: string }) =>
    client.post<Contract>('/contracts', data).then((r) => r.data),

  update: (id: string, data: Partial<{ contractNumber: string; contractType: ContractType; amount: number; startDate: string; endDate: string | null; isActive: boolean; notes: string | null }>) =>
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

  softDelete: (id: string, reason: string) =>
    client.delete(`/contracts/${id}`, { data: { reason } }).then((r) => r.data),

  hardDelete: (id: string) =>
    client.delete(`/contracts/${id}/hard`).then((r) => r.data),

  downloadPrint: (id: string, doc?: string, poaId?: string) =>
    client.get(`/contracts/${id}/print`, {
      params: {
        ...(doc ? { doc } : {}),
        ...(poaId ? { poaId } : {}),
        ts: Date.now(),
      },
      headers: { Accept: 'application/pdf' },
      responseType: 'blob',
    }).then((r) => {
      const fallbackDoc = PRINT_FILENAME_BY_DOC[(doc || 'CONTRACT').toUpperCase()] || 'contract';
      const filename = getFilenameFromDisposition(
        r.headers['content-disposition'],
        `${fallbackDoc}-${id}.pdf`,
      );
      downloadBlob(r.data, filename);
    }),

  getPrintUrl: (id: string, doc?: string) => {
    const baseURL = client.defaults.baseURL || '';
    const query = doc ? `?doc=${doc}` : '';
    return `${baseURL}/contracts/${id}/print${query}`;
  },
};
