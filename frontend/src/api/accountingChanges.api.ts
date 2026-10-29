import client from './client';
import type { DealStatus } from '../types';

/** Что поменялось в сделке на перечисление — см. backend accounting-changes.service.ts. */
export type AccountingChangeKind = 'price' | 'qty' | 'added' | 'removed' | 'amount' | 'discount' | 'vat' | 'paymentMethod';

export interface AccountingChangeLine {
  kind: AccountingChangeKind;
  product?: string;
  unit?: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

export interface AccountingChange {
  id: string;
  dealId: string;
  changes: AccountingChangeLine[];
  editCount: number;
  createdAt: string;
  lastChangedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  changedBy: { id: string; fullName: string };
  reviewedBy: { id: string; fullName: string } | null;
  deal: {
    id: string;
    title: string;
    status: DealStatus;
    amount: number;
    paymentMethod: string | null;
    /** ИНН перечисления (или клиента) и юр. имя из справочника «ИНН и сверка». */
    inn: string | null;
    legalName: string | null;
    client: { id: string; companyName: string; inn: string | null } | null;
    contract: { id: string; contractNumber: string; contractType: 'ONE_TIME' | 'ANNUAL'; startDate: string } | null;
    manager: { id: string; fullName: string } | null;
  } | null;
}

export const accountingChangesApi = {
  list: (status: 'open' | 'reviewed', dealId?: string) =>
    client.get<AccountingChange[]>('/accounting-changes', { params: { status, dealId } }).then((r) => r.data),
  summary: () =>
    client.get<{ open: number; latest: AccountingChange[] }>('/accounting-changes/summary').then((r) => r.data),
  review: (id: string, note?: string) =>
    client.post<AccountingChange>(`/accounting-changes/${id}/review`, { note }).then((r) => r.data),
};
