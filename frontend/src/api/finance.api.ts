import client from './client';

export interface CashboxPayment {
  id: string;
  dealId: string;
  dealTitle: string;
  clientId: string;
  clientName: string;
  amount: number;
  paidAt: string;
  method: string | null;
  note: string | null;
  createdBy: string;
  receivedBy: string;
  manager: string;
  dealPaymentStatus: string;
  entryType: 'DEBT_COLLECTION' | 'SALE_PAYMENT';
}

export interface CashboxResponse {
  payments: CashboxPayment[];
  totals: { totalAmount: number; todayTotal: number; count: number };
  byMethod: { method: string; total: number }[];
  byDay: { day: string; total: number }[];
  period: string;
  fromDate: string;
}

export interface ActiveDealRow {
  dealId: string;
  title: string;
  status: string;
  clientId: string;
  clientName: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  manager: { id: string; fullName: string } | null;
}

export interface ActiveDealsResponse {
  deals: ActiveDealRow[];
  totals: { totalAmount: number; totalPaid: number; totalRemaining: number };
  count: number;
}

export interface DealPaymentContextDeal {
  dealId: string;
  title: string;
  status: string;
  clientId: string;
  clientName: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  overpaymentOnThisDeal: number;
}

export interface DealPaymentContextResponse {
  deal: DealPaymentContextDeal;
  creditFromOtherDeals: number;
}

export const financeApi = {
  cashbox: (params?: {
    period?: string;
    managerId?: string;
    clientId?: string;
    method?: string;
    paymentStatus?: string;
    entryType?: 'DEBT_COLLECTION' | 'SALE_PAYMENT';
  }) =>
    client
      .get<CashboxResponse>('/finance/cashbox', { params })
      .then((r) => r.data),

  getDebts: (params?: {
    minDebt?: number;
    managerId?: string;
    paymentStatus?: string;
  }) =>
    client.get('/finance/debts', { params }).then((r) => r.data),

  getActiveDeals: (params?: { managerId?: string }) =>
    client.get<ActiveDealsResponse>('/finance/active-deals', { params }).then((r) => r.data),

  getDealPaymentContext: (dealId: string) =>
    client.get<DealPaymentContextResponse>(`/finance/deals/${dealId}/payment-context`).then((r) => r.data),

  applyClientCreditToDeal: (dealId: string, body: { amount: number; note?: string; paidAt?: string }) =>
    client.post(`/finance/deals/${dealId}/apply-client-credit`, body).then((r) => r.data),

  clientDebtDetail: (clientId: string) =>
    client.get(`/finance/debts/client/${clientId}`).then((r) => r.data),
};
