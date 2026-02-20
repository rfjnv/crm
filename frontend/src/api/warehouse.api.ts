import client from './client';
import type { Product, InventoryMovement, DashboardSummary, Deal, RevenueTodayResponse } from '../types';

export const inventoryApi = {
  listProducts: () => client.get<Product[]>('/inventory/products').then((r) => r.data),

  createProduct: (data: { name: string; sku: string; unit?: string; category?: string; countryOfOrigin?: string; minStock?: number; purchasePrice?: number; salePrice?: number; specifications?: Record<string, unknown> }) =>
    client.post<Product>('/inventory/products', data).then((r) => r.data),

  updateProduct: (id: string, data: Partial<{ name: string; sku: string; unit: string; category: string | null; countryOfOrigin: string | null; minStock: number; purchasePrice: number | null; salePrice: number | null; specifications: Record<string, unknown> | null; isActive: boolean }>) =>
    client.patch<Product>(`/inventory/products/${id}`, data).then((r) => r.data),

  deleteProduct: (id: string) =>
    client.delete(`/inventory/products/${id}`).then((r) => r.data),

  getProductMovements: (id: string) =>
    client.get<InventoryMovement[]>(`/inventory/products/${id}/movements`).then((r) => r.data),

  createMovement: (data: { productId: string; type: 'IN' | 'OUT'; quantity: number; dealId?: string; note?: string }) =>
    client.post<InventoryMovement>('/inventory/movements', data).then((r) => r.data),

  listMovements: (productId?: string) =>
    client.get<InventoryMovement[]>('/inventory/movements', { params: productId ? { productId } : {} }).then((r) => r.data),

  // Approvals
  getApprovals: () => client.get<Deal[]>('/inventory/approvals').then((r) => r.data),

  approve: (dealId: string) =>
    client.post<Deal>(`/inventory/approvals/${dealId}/approve`).then((r) => r.data),

  reject: (dealId: string) =>
    client.post<Deal>(`/inventory/approvals/${dealId}/reject`).then((r) => r.data),
};

export const dashboardApi = {
  summary: () => client.get<DashboardSummary>('/dashboard/analytics').then((r) => r.data),
  revenueToday: () => client.get<RevenueTodayResponse>('/dashboard/revenue-today').then((r) => r.data),
};
