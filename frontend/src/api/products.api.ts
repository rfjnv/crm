import { client } from './client';
import type { Product } from '../types';

export interface ImportExcelResult {
  successCount: number;
  errorCount: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: number;
}

export const productsApi = {
  list: () => client.get<Product[]>('/inventory/products').then((r) => r.data),
  getById: (id: string) => client.get<Product>(`/inventory/products/${id}`).then((r) => r.data),
  create: (data: unknown) => client.post<Product>('/inventory/products', data).then((r) => r.data),
  update: (id: string, data: unknown) => client.patch<Product>(`/inventory/products/${id}`, data).then((r) => r.data),
  delete: (id: string) => client.delete<{ success: boolean }>(`/inventory/products/${id}`).then((r) => r.data),
  correctStock: (id: string, data: { newStock: number; reason: string }) =>
    client.post<Product>(`/inventory/products/${id}/correct-stock`, data).then((r) => r.data),
  importFromExcel: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post<ImportExcelResult>('/inventory/import-excel', formData).then((r) => r.data);
  },
};
