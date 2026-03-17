import client from './client';
import type { ContractType } from '../types';
import { downloadBlob, getFilenameFromDisposition } from '../utils/download';

export interface PoaItem {
  name: string;
  unit: string;
  qty?: number;
}

export interface PowerOfAttorney {
  id: string;
  contractId: string;
  poaNumber: string;
  poaType: ContractType;
  authorizedPersonName: string;
  authorizedPersonInn?: string | null;
  authorizedPersonPosition?: string | null;
  validFrom: string;
  validUntil: string;
  items?: PoaItem[] | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  contract?: { id: string; contractNumber: string; client?: { id: string; companyName: string } };
}

export interface CreatePoaData {
  contractId: string;
  poaNumber: string;
  poaType: ContractType;
  authorizedPersonName: string;
  authorizedPersonInn?: string;
  authorizedPersonPosition?: string;
  validFrom: string;
  validUntil: string;
  items?: PoaItem[];
  notes?: string;
}

export interface UpdatePoaData {
  poaNumber?: string;
  poaType?: ContractType;
  authorizedPersonName?: string;
  authorizedPersonInn?: string;
  authorizedPersonPosition?: string;
  validFrom?: string;
  validUntil?: string;
  items?: PoaItem[];
  notes?: string;
}

export const poaApi = {
  list: (contractId?: string) =>
    client.get<PowerOfAttorney[]>('/power-of-attorney', { params: contractId ? { contractId } : {} }).then((r) => r.data),

  getById: (id: string) =>
    client.get<PowerOfAttorney>(`/power-of-attorney/${id}`).then((r) => r.data),

  create: (data: CreatePoaData) =>
    client.post<PowerOfAttorney>('/power-of-attorney', data).then((r) => r.data),

  update: (id: string, data: UpdatePoaData) =>
    client.patch<PowerOfAttorney>(`/power-of-attorney/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    client.delete(`/power-of-attorney/${id}`).then((r) => r.data),

  downloadPrint: (id: string) =>
    client.get(`/power-of-attorney/${id}/print`, {
      responseType: 'blob',
    }).then((r) => {
      const filename = getFilenameFromDisposition(
        r.headers['content-disposition'],
        `power-of-attorney-${id}.pdf`,
      );
      downloadBlob(r.data, filename);
    }),

  getPrintUrl: (id: string) => {
    const baseURL = client.defaults.baseURL || '';
    return `${baseURL}/power-of-attorney/${id}/print`;
  },
};
