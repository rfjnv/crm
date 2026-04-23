import client from './client';

export interface CbuRate {
  code: string;
  nameRu: string;
  nominal: number;
  rate: number;
  diff: number;
  /** dd.mm.yyyy (как отдал ЦБ) */
  date: string;
  /** YYYY-MM-DD */
  rawDate?: string;
}

export interface CbuRatesPayload {
  fetchedAt: string;
  date: string | null;
  rates: CbuRate[];
  stale?: boolean;
}

export interface StoredExchangeRate {
  date: string;
  currency: string;
  rate: number;
  nominal: number;
  source: string;
}

export interface FindRateResponse {
  rate: number;
  sourceDate: string;
}

export interface SyncResult {
  fetched: number;
  upserted: number;
  skipped: number;
  sourceDate: string | null;
  errors: string[];
}

export const cbuApi = {
  rates: () => client.get<CbuRatesPayload>('/foreign-trade/cbu-rates').then((r) => r.data),

  listStored: (params: { from?: string; to?: string; currency?: string; limit?: number } = {}) =>
    client
      .get<StoredExchangeRate[]>('/foreign-trade/exchange-rates', { params })
      .then((r) => r.data),

  findStored: (date: string, currency: string) =>
    client
      .get<FindRateResponse>('/foreign-trade/exchange-rates/find', {
        params: { date, currency },
      })
      .then((r) => r.data)
      .catch(() => null),

  sync: () =>
    client.post<SyncResult>('/foreign-trade/exchange-rates/sync').then((r) => r.data),
};
