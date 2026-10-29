import client from './client';

export type PaymentMethodCode = 'CASH' | 'TRANSFER' | 'PAYME' | 'QR' | 'CLICK' | 'TERMINAL' | 'INSTALLMENT';

export interface ToPayDeal {
  dealId: string;
  title: string | null;
  status: string;
  clientId: string;
  clientName: string;
  clientIsSvip: boolean;
  contractNumber: string | null;
  amount: number;
  paidAmount: number;
  remaining: number;
  createdAt: string;
  dueDate: string | null;
  manager: { id: string; fullName: string } | null;
}

export interface ToPayResponse {
  deals: ToPayDeal[];
  totals: {
    remaining: number;
    clientCount: number;
    todayReceived: number;
    todayCount: number;
  };
}

export interface ClientOpenDeal {
  dealId: string;
  title: string | null;
  status: string;
  contractNumber: string | null;
  amount: number;
  paidAmount: number;
  remaining: number;
  createdAt: string;
  manager: { id: string; fullName: string } | null;
}

export interface ClientPayCard {
  client: { id: string; companyName: string; contactName: string | null; phone: string | null; isSvip: boolean };
  /** Открытые сделки — от старых к новым, в этом же порядке раскладывается оплата. */
  deals: ClientOpenDeal[];
  totalDebt: number;
  prepayment: number;
  recentPayments: {
    id: string;
    amount: number;
    paidAt: string;
    method: string | null;
    kind: string;
    dealId: string;
    dealTitle: string | null;
  }[];
}

export interface ClientPaymentResult {
  payments: { paymentId: string; dealId: string; title: string | null; amount: number; paymentStatus: string }[];
  overpayment: number;
}

export const cashboxV2Api = {
  toPay: (params?: { managerId?: string }) =>
    client.get<ToPayResponse>('/cashbox-v2/to-pay', { params }).then((r) => r.data),

  clientCard: (clientId: string) =>
    client.get<ClientPayCard>(`/cashbox-v2/clients/${clientId}`).then((r) => r.data),

  payClient: (clientId: string, body: {
    amount: number;
    method: PaymentMethodCode;
    dealIds: string[];
    paidAt?: string;
    note?: string;
    receivedById?: string;
  }) =>
    client.post<ClientPaymentResult>(`/cashbox-v2/clients/${clientId}/payments`, body).then((r) => r.data),
};
