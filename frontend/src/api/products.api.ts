import client, { API_URL } from './client';
import type { Product, ProductPosterPhoto } from '../types';
import { useAuthStore } from '../store/authStore';

export interface ImportExcelResult {
  successCount: number;
  errorCount: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: number;
}

export const productsApi = {
  list: () => client.get<Product[]>('/inventory/products').then((r: any) => r.data),
  getById: (id: string) => client.get<Product>(`/inventory/products/${id}`).then((r: any) => r.data),
  create: (data: unknown) => client.post<Product>('/inventory/products', data).then((r: any) => r.data),
  update: (id: string, data: unknown) => client.patch<Product>(`/inventory/products/${id}`, data).then((r: any) => r.data),
  delete: (id: string) => client.delete<{ success: boolean }>(`/inventory/products/${id}`).then((r: any) => r.data),
  correctStock: (id: string, data: { newStock: number; reason: string }) =>
    client.post<Product>(`/inventory/products/${id}/correct-stock`, data).then((r: any) => r.data),
  importFromExcel: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post<ImportExcelResult>('/inventory/import-excel', formData).then((r: any) => r.data);
  },
  uploadPosterPhotos: async (id: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((f) => formData.append('images', f));
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${API_URL}/inventory/products/${id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || `Не удалось загрузить фото (HTTP ${res.status})`);
    }
    return res.json() as Promise<ProductPosterPhoto[]>;
  },
  deletePosterPhoto: (id: string, photoId: string) =>
    client.delete<{ success: boolean }>(`/inventory/products/${id}/photos/${photoId}`).then((r: any) => r.data),
};
