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
  deal: { id: string; title: string } | null;
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

export interface RecognizedRow {
  category: string;
  format: string | null;
  qty: number;
  price: number | null;
  sum: number | null;
  uncertain: boolean;
  product: PaymentRequestProduct | null;
  candidates: PaymentRequestProduct[];
}

export interface RecognizedTable {
  period: { from: string; to: string } | null;
  periodText: string | null;
  method: 'TRANSFER' | null;
  rows: RecognizedRow[];
  total: number | null;
  warnings: string[];
}

export interface DealOption {
  id: string;
  title: string;
  status: string;
  date: string;
  amount: number;
  debt: number;
}

export interface DealGoods {
  deal: {
    id: string;
    title: string;
    status: string;
    date: string;
    client: { id: string; companyName: string };
    amount: number;
    paid: number;
    debt: number;
    pendingAmount: number;
  };
  lines: {
    dealItemId: string;
    product: PaymentRequestProduct;
    qty: number;
    price: number;
    lineTotal: number;
    requestedQty: number;
  }[];
}

export interface CreatePaymentRequestPayload {
  clientId: string;
  dealId?: string;
  from?: string;
  to?: string;
  method: string;
  note?: string;
  items: { productId: string; dealItemId?: string; qty: number; price: number }[];
}

export const paymentRequestsApi = {
  summary: () => client.get<{ pending: number }>('/payment-requests/summary').then((r) => r.data),
  list: (status?: PaymentRequestStatus) =>
    client.get<PaymentRequest[]>('/payment-requests', { params: { status } }).then((r) => r.data),
  available: (clientId: string, from: string, to: string) =>
    client.get<AvailableGoods>('/payment-requests/available', { params: { clientId, from, to } }).then((r) => r.data),
  deals: (clientId: string) =>
    client.get<DealOption[]>('/payment-requests/deals', { params: { clientId } }).then((r) => r.data),
  dealGoods: (dealId: string) =>
    client.get<DealGoods>(`/payment-requests/deal/${dealId}`).then((r) => r.data),
  recognize: (image: Blob) => {
    const form = new FormData();
    form.append('image', image, 'table');
    return client
      .post<RecognizedTable>('/payment-requests/recognize', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 150_000,
      })
      .then((r) => r.data);
  },
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
