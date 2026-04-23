/**
 * HTTP-клиент к API ЦБ Узбекистана.
 * Источник: https://cbu.uz/ru/arkhiv-kursov-valyut/json/
 *
 * Используется:
 *  - cbu-rates.routes.ts (proxy-виджет на фронт)
 *  - exchange-rates.service.ts (persist в БД)
 */

export const CBU_URL = 'https://cbu.uz/ru/arkhiv-kursov-valyut/json/';

/** Валюты ВЭД, которые мы храним и показываем (MVP-3). */
export const VED_CURRENCIES = ['USD', 'EUR', 'CNY', 'RUB', 'GBP'] as const;
export type VedCurrency = (typeof VED_CURRENCIES)[number];

export const VED_CURRENCIES_SET: Set<string> = new Set<string>(VED_CURRENCIES);

export interface CbuRawRate {
  Ccy: string;
  CcyNm_RU: string;
  Nominal: string;
  Rate: string;
  Diff: string;
  /** dd.mm.yyyy */
  Date: string;
}

export interface NormalizedRate {
  code: string;
  nameRu: string;
  nominal: number;
  rate: number;
  diff: number;
  /** Нормализованная дата YYYY-MM-DD */
  date: string;
  /** Исходная строка "dd.mm.yyyy" (как вернул ЦБ) */
  rawDate: string;
}

/** Превращает "23.04.2026" → "2026-04-23". */
export function toIsoDate(ddmmyyyy: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ddmmyyyy.trim());
  if (!m) return ddmmyyyy;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Забирает полный массив валют от ЦБ и оставляет только ВЭД-набор.
 * Бросает ошибку на сетевых/парсинг-ошибках.
 */
export async function fetchCbuRates(): Promise<NormalizedRate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  let raw: CbuRawRate[];
  try {
    const resp = await fetch(CBU_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`CBU responded with ${resp.status}`);
    }
    raw = (await resp.json()) as CbuRawRate[];
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(raw)) {
    throw new Error('CBU returned unexpected payload (not an array)');
  }

  return raw
    .filter((r) => VED_CURRENCIES_SET.has(r.Ccy))
    .map((r) => ({
      code: r.Ccy,
      nameRu: r.CcyNm_RU,
      nominal: Number(r.Nominal) || 1,
      rate: Number(r.Rate),
      diff: Number(r.Diff),
      date: toIsoDate(r.Date),
      rawDate: r.Date,
    }));
}
