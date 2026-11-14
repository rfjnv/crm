import client from './client';

export interface FinanceReportPart {
  /** Товарооборот с НДС (как в строках сделок) */
  revenueGross: number;
  /** Товарооборот без НДС */
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

export interface FinanceReportSlice {
  cash: FinanceReportPart;
  transfer: FinanceReportPart;
  all: FinanceReportPart;
}

export interface FinanceReportExpenseRow {
  category: string;
  count?: number;
  total: number;
  byMonth: Record<string, number>;
}

export interface FinanceReport {
  from: string;
  to: string;
  months: string[];
  vatRate: number;
  columns: (FinanceReportSlice & { month: string })[];
  total: FinanceReportSlice;
  expenses: { cash: FinanceReportExpenseRow[]; transfer: FinanceReportExpenseRow[] };
  nonOperating: FinanceReportExpenseRow[];
  warnings: {
    linesWithoutPurchasePrice: number;
    revenueWithoutPurchasePrice: number;
    foreignExpensesWithoutRate: number;
  };
}

export const financeReportApi = {
  get: (from: string, to: string) =>
    client.get<FinanceReport>('/finance/report', { params: { from, to } }).then((r) => r.data),
};
