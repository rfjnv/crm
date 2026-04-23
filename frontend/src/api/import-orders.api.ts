import client from './client';
import type {
  ImportOrder,
  ImportOrderListItem,
  ImportOrderDetail,
  ImportOrderStatus,
  ImportOrderAttachment,
  ImportDocumentType,
  SupplierCurrency,
  LandedCostReport,
} from '../types';

export interface ImportOrderItemPayload {
  productId: string;
  qty: number;
  unitPrice: number;
  comment?: string | null;
}

export interface CreateImportOrderPayload {
  number: string;
  supplierId: string;
  currency?: SupplierCurrency;
  orderDate: string;
  etd?: string | null;
  eta?: string | null;
  containerNumber?: string | null;
  invoiceNumber?: string | null;
  invoiceRate?: number | null;
  notes?: string | null;
  items?: ImportOrderItemPayload[];
}

export interface UpdateImportOrderPayload {
  number?: string;
  supplierId?: string;
  currency?: SupplierCurrency;
  orderDate?: string;
  etd?: string | null;
  eta?: string | null;
  containerNumber?: string | null;
  invoiceNumber?: string | null;
  invoiceRate?: number | null;
  notes?: string | null;
}

export const importOrdersApi = {
  list: (params?: { status?: ImportOrderStatus; supplierId?: string; search?: string }) =>
    client
      .get<ImportOrderListItem[]>('/import-orders', {
        params: {
          ...(params?.status ? { status: params.status } : {}),
          ...(params?.supplierId ? { supplierId: params.supplierId } : {}),
          ...(params?.search ? { search: params.search } : {}),
        },
      })
      .then((r) => r.data),

  getById: (id: string) =>
    client.get<ImportOrderDetail>(`/import-orders/${id}`).then((r) => r.data),

  getLandedCost: (id: string) =>
    client.get<LandedCostReport>(`/import-orders/${id}/landed-cost`).then((r) => r.data),

  create: (data: CreateImportOrderPayload) =>
    client.post<ImportOrder>('/import-orders', data).then((r) => r.data),

  update: (id: string, data: UpdateImportOrderPayload) =>
    client.patch<ImportOrder>(`/import-orders/${id}`, data).then((r) => r.data),

  replaceItems: (id: string, items: ImportOrderItemPayload[]) =>
    client.put<ImportOrderDetail>(`/import-orders/${id}/items`, { items }).then((r) => r.data),

  changeStatus: (id: string, status: ImportOrderStatus) =>
    client.post<ImportOrder>(`/import-orders/${id}/status`, { status }).then((r) => r.data),

  uploadAttachment: (id: string, file: File, documentType: ImportDocumentType) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    return client
      .post<ImportOrderAttachment>(`/import-orders/${id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  deleteAttachment: (id: string, attachmentId: string) =>
    client.delete(`/import-orders/${id}/attachments/${attachmentId}`).then((r) => r.data),
};
