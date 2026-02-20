import client from './client';
import type { Deal, DealItem, DealComment, AuditLog, DealStatus, DealHistoryEntry, Shipment, PaymentRecord } from '../types';

export const dealsApi = {
  list: (status?: DealStatus, includeClosed?: boolean) =>
    client.get<Deal[]>('/deals', { params: { ...(status ? { status } : {}), ...(includeClosed ? { includeClosed: 'true' } : {}) } }).then((r) => r.data),

  getById: (id: string) => client.get<Deal>(`/deals/${id}`).then((r) => r.data),

  create: (data: {
    title?: string;
    clientId: string;
    contractId?: string;
    paymentType?: 'FULL' | 'PARTIAL' | 'DEBT';
    dueDate?: string;
    terms?: string;
    discount?: number;
    items: { productId: string; requestedQty?: number; price?: number; requestComment?: string }[];
  }) =>
    client.post<Deal>('/deals', data).then((r) => r.data),

  update: (id: string, data: Partial<{ title: string; status: DealStatus; contractId: string | null; discount: number; terms: string | null; managerId: string }>) =>
    client.patch<Deal>(`/deals/${id}`, data).then((r) => r.data),

  updatePayment: (id: string, data: { paidAmount: number; paymentType?: 'FULL' | 'PARTIAL' | 'DEBT'; dueDate?: string | null; terms?: string | null }) =>
    client.patch<Deal>(`/deals/${id}/payment`, data).then((r) => r.data),

  archive: (id: string) => client.patch<Deal>(`/deals/${id}/archive`).then((r) => r.data),

  getLogs: (id: string) => client.get<AuditLog[]>(`/deals/${id}/logs`).then((r) => r.data),

  getComments: (id: string) =>
    client.get<DealComment[]>(`/deals/${id}/comments`).then((r) => r.data),

  addComment: (id: string, text: string) =>
    client.post<DealComment>(`/deals/${id}/comments`, { text }).then((r) => r.data),

  // Deal Items
  getItems: (dealId: string) =>
    client.get<DealItem[]>(`/deals/${dealId}/items`).then((r) => r.data),

  addItem: (dealId: string, data: { productId: string; requestComment?: string }) =>
    client.post<DealItem>(`/deals/${dealId}/items`, data).then((r) => r.data),

  removeItem: (dealId: string, itemId: string) =>
    client.delete(`/deals/${dealId}/items/${itemId}`).then((r) => r.data),

  getHistory: (id: string) =>
    client.get<DealHistoryEntry[]>(`/deals/${id}/history`).then((r) => r.data),

  // Workflow: Warehouse Response (comment-only)
  submitWarehouseResponse: (dealId: string, items: {
    dealItemId: string;
    warehouseComment: string;
  }[]) =>
    client.post<Deal>(`/deals/${dealId}/stock-confirm`, { items }).then((r) => r.data),

  // Workflow: Set Item Quantities (manager fills after warehouse response)
  setItemQuantities: (dealId: string, data: {
    items: { dealItemId: string; requestedQty: number; price: number }[];
    discount?: number;
    paymentType?: 'FULL' | 'PARTIAL' | 'DEBT';
    paidAmount?: number;
    dueDate?: string;
    terms?: string;
  }) =>
    client.post<Deal>(`/deals/${dealId}/set-quantities`, data).then((r) => r.data),

  stockConfirmationQueue: () =>
    client.get<Deal[]>('/deals/stock-confirmation-queue').then((r) => r.data),

  // Workflow: Finance
  approveFinance: (dealId: string) =>
    client.post<Deal>(`/deals/${dealId}/finance-approve`).then((r) => r.data),

  rejectFinance: (dealId: string, reason: string) =>
    client.post<Deal>(`/deals/${dealId}/finance-reject`, { reason }).then((r) => r.data),

  // Workflow: Admin Approve
  approveAdmin: (dealId: string) =>
    client.post<Deal>(`/deals/${dealId}/admin-approve`).then((r) => r.data),

  // Workflow: Shipment
  submitShipment: (dealId: string, data: {
    vehicleType: string;
    vehicleNumber: string;
    driverName: string;
    departureTime: string;
    deliveryNoteNumber: string;
    shipmentComment?: string;
  }) =>
    client.post<Deal>(`/deals/${dealId}/shipment`, data).then((r) => r.data),

  getShipment: (dealId: string) =>
    client.get<Shipment>(`/deals/${dealId}/shipment`).then((r) => r.data),

  // Payment Records
  createPayment: (dealId: string, data: { amount: number; method?: string; note?: string; paidAt?: string }) =>
    client.post<PaymentRecord>(`/deals/${dealId}/payments`, data).then((r) => r.data),

  getDealPayments: (dealId: string) =>
    client.get<PaymentRecord[]>(`/deals/${dealId}/payments`).then((r) => r.data),

  // Workflow Queues
  financeQueue: () =>
    client.get<(Deal & { clientDebt: number })[]>('/deals/finance-queue').then((r) => r.data),

  shipmentQueue: () =>
    client.get<Deal[]>('/deals/shipment-queue').then((r) => r.data),

  holdShipment: (dealId: string, reason: string) =>
    client.post<Deal>(`/deals/${dealId}/shipment-hold`, { reason }).then((r) => r.data),

  releaseShipmentHold: (dealId: string) =>
    client.post<Deal>(`/deals/${dealId}/shipment-release`).then((r) => r.data),
};
