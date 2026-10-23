import client from './client';

export type InnIssue =
  | 'bad_format'
  | 'dirty_format'
  | 'no_name'
  | 'shared_owner'
  | 'shared_transfer'
  | 'other_client_inn'
  | 'client_without_inn'
  | 'name_mismatch';

export interface InnClientLink {
  clientId: string;
  companyName: string;
  isArchived: boolean;
  isOwn: boolean;
  clientHasNoInn: boolean;
  dealsCount: number;
  dealsSum: number;
  lastDealAt: string | null;
}

export interface InnRow {
  inn: string;
  rawVariants: string[];
  legalName: string | null;
  address: string | null;
  source: string | null;
  lookupStatus: string | null;
  lookedUpAt: string | null;
  clients: InnClientLink[];
  dealsCount: number;
  dealsSum: number;
  issues: InnIssue[];
}

export interface InnReconciliation {
  rows: InnRow[];
  summary: Partial<Record<InnIssue | 'total', number>>;
}

export const innRegistryApi = {
  reconciliation: () => client.get<InnReconciliation>('/inn-registry').then((r) => r.data),
  setName: (inn: string, legalName: string | null) =>
    client.put(`/inn-registry/${encodeURIComponent(inn)}`, { legalName }).then((r) => r.data),
  lookup: (inn: string, overwrite = false) =>
    client.post(`/inn-registry/${encodeURIComponent(inn)}/lookup${overwrite ? '?overwrite=1' : ''}`).then((r) => r.data),
  lookupMissing: (limit = 20) =>
    client
      .post<{ checked: number; found: number; left: number }>('/inn-registry/lookup-missing', { limit }, { timeout: 120000 })
      .then((r) => r.data),
  names: (inns: string[]) =>
    inns.length === 0
      ? Promise.resolve({} as Record<string, string>)
      : client
        .get<Record<string, string>>('/inn-registry/names', { params: { inn: inns.join(',') } })
        .then((r) => r.data),
};
