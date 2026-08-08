import client from './client';

export interface CashboxPayment {
  id: string;
  dealId: string;
  dealTitle: string;
  clientId: string;
  clientName: string;
  clientIsSvip?: boolean;
  amount: number;
  paidAt: string;
  method: string | null;
  note: string | null;
  receivedBy: string;
  manager: string;
  dealPaymentStatus: string;
  entryType: 'DEBT_COLLECTION' | 'SALE_PAYMENT';
  /** Денежная проводка или служебная — в итоги входит только CASH_IN / REVERSAL. */
  kind: 'CASH_IN' | 'CREDIT_TRANSFER' | 'ADJUSTMENT' | 'REVERSAL';
}

export interface CashboxResponse {
  payments: CashboxPayment[];
  totals: {
    totalAmount: number;
    todayTotal: number;
    count: number;
    /** Сумма служебных проводок в периоде — показывается отдельно, в деньги не входит. */
    nonCashAmount: number;
    nonCashCount: number;
  };
  byMethod: { method: string; total: number }[];
  period: string;
  fromDate: string;
}

export interface ActiveDealRow {
  dealId: string;
  title: string;
  status: string;
  clientId: string;
  clientName: string;
  clientIsSvip?: boolean;
  amount: number;
  paidAmount: number;
  remaining: number;
  isReceiptPunched?: boolean;
  /** Сделка закрыта сегодня — остаётся в «Активных» до конца дня, чтобы принять по ней оплату. */
  closedToday?: boolean;
  manager: { id: string; fullName: string } | null;
}

export interface ActiveDealsResponse {
  deals: ActiveDealRow[];
  totals: { totalAmount: number; totalPaid: number; totalRemaining: number };
  count: number;
  closedTodayCount: number;
}

/** Сделка, найденная поиском для приёма оплаты — любого статуса, кроме отменённых. */
export interface PayableDealRow {
  dealId: string;
  title: string;
  status: string;
  clientId: string;
  clientName: string;
  clientIsSvip?: boolean;
  contractNumber: string | null;
  amount: number;
  paidAmount: number;
  remaining: number;
  manager: { id: string; fullName: string } | null;
  createdAt: string;
}

export interface DealPaymentContextDeal {
  dealId: string;
  title: string;
  status: string;
  clientId: string;
  clientName: string;
  clientIsSvip?: boolean;
  amount: number;
  paidAmount: number;
  remaining: number;
  overpaymentOnThisDeal: number;
}

/** Сделка, с которой будет списана переплата при зачёте. */
export interface CreditSource {
  dealId: string;
  title: string;
  status: string;
  surplus: number;
}

export interface DealPaymentContextResponse {
  deal: DealPaymentContextDeal;
  creditFromOtherDeals: number;
  /** Разбивка переплаты по сделкам, в порядке списания (от большей суммы). */
  creditSources: CreditSource[];
}

/**
 * Ответ на зачёт переплаты. Доступный пул может быть меньше запрошенной суммы —
 * тогда бэкенд списывает сколько есть и сообщает об этом здесь.
 */
export interface ApplyCreditResult {
  id: string;
  appliedAmount: number;
  requestedAmount: number;
  partiallyApplied: boolean;
  sources: { id: string; title: string | null; amount: number }[];
}

export interface CompanyBalanceChartPoint {
  day: string;
  balance?: number;
  incoming?: number;
  outgoing?: number;
  total?: number;
}

export interface CompanyBalanceIncomeVsExpensePoint {
  day: string;
  incoming: number;
  outgoing: number;
  net: number;
}

export interface CompanyBalanceMethodDayPoint {
  day: string;
  method: string;
  amount: number;
}

export interface CompanyBalanceMethodAgg {
  incoming: number;
  outgoing: number;
  net: number;
  incomingInRange: number;
  outgoingInRange: number;
}

export interface CompanyBalanceRecentIncoming {
  id: string;
  paidAt: string;
  amount: number;
  method: string | null;
  note: string | null;
  deal: { id: string; title: string } | null;
  client: { id: string; name: string } | null;
  creator: { id: string; fullName: string } | null;
  receivedBy: { id: string; fullName: string } | null;
}

export interface CompanyBalanceResponse {
  setupRequired: boolean;
  updatedAt?: string;
  startDate?: string;
  initialBalance?: number;
  filters?: { period: string; method: string | null; managerId: string | null };
  kpi?: {
    balance: number;
    cash: number;
    bank: number;
    incomingAll?: number;
    expensesAll?: number;
    incomingInRange?: number;
    outgoingInRange?: number;
    netInRange?: number;
  };
  breakdown?: { real: number; expected: number; debts: number };
  byMethod?: Record<string, CompanyBalanceMethodAgg>;
  recentIncoming?: CompanyBalanceRecentIncoming[];
  charts?: {
    balanceLine: CompanyBalanceChartPoint[];
    cashFlow: CompanyBalanceChartPoint[];
    paymentsPerDay: CompanyBalanceChartPoint[];
    incomeVsExpense: CompanyBalanceIncomeVsExpensePoint[];
    incomingByDayMethod: CompanyBalanceMethodDayPoint[];
    expenseByDayMethod: CompanyBalanceMethodDayPoint[];
  };
}

export const financeApi = {
  cashbox: (params?: {
    period?: string;
    /** Для period='custom' — границы диапазона в ISO. */
    from?: string;
    to?: string;
    managerId?: string;
    receivedById?: string;
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

  searchPayableDeals: (q: string) =>
    client
      .get<{ deals: PayableDealRow[]; query: string }>('/finance/payable-deals', { params: { q } })
      .then((r) => r.data),

  getDealPaymentContext: (dealId: string) =>
    client.get<DealPaymentContextResponse>(`/finance/deals/${dealId}/payment-context`).then((r) => r.data),

  applyClientCreditToDeal: (dealId: string, body: { amount: number; note?: string; paidAt?: string }) =>
    client
      .post<ApplyCreditResult>(`/finance/deals/${dealId}/apply-client-credit`, body)
      .then((r) => r.data),

  clientDebtDetail: (clientId: string) =>
    client.get(`/finance/debts/client/${clientId}`).then((r) => r.data),

  companyBalance: (params?: { period?: 'day' | 'week' | 'month' | 'year'; method?: string; managerId?: string }) =>
    client.get<CompanyBalanceResponse>('/finance/company-balance', { params }).then((r) => r.data),
};
