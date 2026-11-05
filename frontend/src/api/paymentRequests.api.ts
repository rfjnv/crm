import client from './client';

export type PaymentRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELED';
export type AllocationSource = 'goods' | 'period' | 'other';

export interface PaymentRequestProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
}

export interface PaymentRequest {
  id: string;
  number: number;
  status: PaymentRequestStatus;
  client: { id: string; companyName: string };
  from: string;
  to: string;
  method: string;
  amount: number;
  note: string | null;
  createdBy: { id: string; fullName: string };
  createdAt: string;
  decidedBy: { id: string; fullName: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  items: { id: string; product: PaymentRequestProduct; qty: number; price: number; lineTotal: number }[];
  payments: { id: string; amount: number; deal: { id: string; title: string } }[];
}

export interface AvailableGoods {
  rows: {
    product: PaymentRequestProduct;
    boughtQty: number;
    boughtValue: number;
    price: number;
    requestedQty: number;
  }[];
  periodDebt: number;
  dealsInPeriod: number;
}

export interface PaymentRequestPreview {
  request: PaymentRequest;
  lines: { product: PaymentRequestProduct; qty: number; price: number; lineTotal: number; boughtQty: number }[];
  allocations: {
    deal: { id: string; title: string; date: string };
    debt: number;
    amount: number;
    source: AllocationSource;
  }[];
  unallocated: number;
}

export interface CreatePaymentRequestPayload {
  clientId: string;
  from: string;
  to: string;
  method: string;
  note?: string;
  items: { productId: string; qty: number; price: number }[];
}

export const paymentRequestsApi = {
  summary: () => client.get<{ pending: number }>('/payment-requests/summary').then((r) => r.data),
  list: (status?: PaymentRequestStatus) =>
    client.get<PaymentRequest[]>('/payment-requests', { params: { status } }).then((r) => r.data),
  available: (clientId: string, from: string, to: string) =>
    client.get<AvailableGoods>('/payment-requests/available', { params: { clientId, from, to } }).then((r) => r.data),
  create: (data: CreatePaymentRequestPayload) =>
    client.post<PaymentRequest>('/payment-requests', data).then((r) => r.data),
  preview: (id: string) =>
    client.get<PaymentRequestPreview>(`/payment-requests/${id}/preview`).then((r) => r.data),
  accept: (id: string, data: { paidAt?: string; note?: string }) =>
    client.post<PaymentRequest>(`/payment-requests/${id}/accept`, data).then((r) => r.data),
  reject: (id: string, reason: string) =>
    client.post<PaymentRequest>(`/payment-requests/${id}/reject`, { reason }).then((r) => r.data),
  cancel: (id: string) =>
    client.post<PaymentRequest>(`/payment-requests/${id}/cancel`).then((r) => r.data),
};
