import client from './client';
import type { Deal, AuditLog } from '../types';

export interface OverrideDealData {
  reason: string;
  title?: string;
  status?: string;
  clientId?: string;
  managerId?: string;
  contractId?: string | null;
  paymentMethod?: string | null;
  paymentType?: string;
  paidAmount?: number;
  dueDate?: string | null;
  createdAt?: string | null;
  discount?: number;
  terms?: string | null;
  deliveryType?: string | null;
  vehicleNumber?: string | null;
  vehicleType?: string | null;
  deliveryComment?: string | null;
  loadingAssigneeId?: string | null;
  deliveryDriverId?: string | null;
  items?: {
    id?: string;
    productId: string;
    requestedQty?: number;
    price?: number;
    requestComment?: string;
    warehouseComment?: string;
    dealDate?: string | null;
    confirmedAt?: string | null;
    createdAt?: string | null;
  }[];
  payments?: {
    id: string;
    paidAt?: string | null;
    createdAt?: string | null;
  }[];
  comments?: {
    id: string;
    createdAt?: string | null;
  }[];
  shipment?: {
    vehicleType: string;
    vehicleNumber: string;
    driverName: string;
    departureTime: string;
    deliveryNoteNumber: string;
    shipmentComment?: string;
    shippedAt?: string | null;
  };
}

export const adminApi = {
  overrideDeal: (id: string, data: OverrideDealData) =>
    client.patch<Deal>(`/admin/deals/${id}/override`, data).then((r) => r.data),

  deleteDeal: (id: string, reason: string) =>
    client.delete<{ success: boolean; deletedDealId: string }>(`/admin/deals/${id}`, { data: { reason } }).then((r) => r.data),

  getDealAudit: (id: string) =>
    client.get<AuditLog[]>(`/admin/deals/${id}/audit`).then((r) => r.data),

  getProductAudit: (productId?: string) =>
    client.get<AuditLog[]>('/admin/products/audit', { params: { productId } }).then((r) => r.data),
};
