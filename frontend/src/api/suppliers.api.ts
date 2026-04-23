import client from './client';
import type {
  Supplier,
  SupplierListItem,
  SupplierDetail,
  SupplierCurrency,
  Incoterms,
} from '../types';

export interface SupplierPayload {
  companyName: string;
  country?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  currency?: SupplierCurrency;
  incoterms?: Incoterms | null;
  paymentTerms?: string | null;
  bankSwift?: string | null;
  iban?: string | null;
  notes?: string | null;
}

export const suppliersApi = {
  list: (params?: { includeArchived?: boolean; search?: string }) =>
    client
      .get<SupplierListItem[]>('/suppliers', {
        params: {
          ...(params?.includeArchived ? { includeArchived: 'true' } : {}),
          ...(params?.search ? { search: params.search } : {}),
        },
      })
      .then((r) => r.data),

  getById: (id: string) => client.get<SupplierDetail>(`/suppliers/${id}`).then((r) => r.data),

  create: (data: SupplierPayload) =>
    client.post<Supplier>('/suppliers', data).then((r) => r.data),

  update: (id: string, data: Partial<SupplierPayload & { isArchived: boolean }>) =>
    client.patch<Supplier>(`/suppliers/${id}`, data).then((r) => r.data),

  toggleArchive: (id: string) =>
    client.post<Supplier>(`/suppliers/${id}/archive`).then((r) => r.data),
};
