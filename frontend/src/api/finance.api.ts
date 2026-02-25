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
}

export interface CashboxResponse {
  payments: CashboxPayment[];
  totals: { totalAmount: number; todayTotal: number; count: number };
  byMethod: { method: string; total: number }[];
  byDay: { day: string; total: number }[];
  period: string;
  fromDate: string;
}

export const financeApi = {
  cashbox: (params?: {
    period?: string;
    managerId?: string;
    clientId?: string;
    method?: string;
    paymentStatus?: string;
  }) =>
    client
      .get<CashboxResponse>('/finance/cashbox', { params })
      .then((r) => r.data),

  getDayClosings: () =>
    client.get('/finance/day-closings').then((r) => r.data),

  closeDay: () =>
    client.post('/finance/day-closing', {}).then((r) => r.data),

  getDebts: () =>
    client.get('/finance/debts').then((r) => r.data),

  clientDebtDetail: (clientId: string) =>
    client.get(`/finance/debts/${clientId}`).then((r) => r.data),
};
