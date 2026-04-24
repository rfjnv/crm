/**
 * HTTP-клиент к API ЦБ Узбекистана.
 * Источник: https://cbu.uz/ru/arkhiv-kursov-valyut/json/
 *
 * Используется:
 *  - cbu-rates.routes.ts (proxy-виджет на фронт)
 *  - exchange-rates.service.ts (persist в БД)
 *
 * На части хостингов запросы без User-Agent / с «холодного» IP режутся или отвечают пусто.
 * Поэтому: браузероподобные заголовки, несколько URL и короткий повтор.
 */

export const CBU_URL = 'https://cbu.uz/ru/arkhiv-kursov-valyut/json/';

/** Календарная дата Asia/Tashkent (UTC+5) в формате YYYY-MM-DD — для /json/all/{date}/ */
function tashkentYmd(): string {
  const t = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function cbuFetchUrls(): string[] {
  const ymd = tashkentYmd();
  return [
    CBU_URL,
    'https://www.cbu.uz/ru/arkhiv-kursov-valyut/json/',
    `https://cbu.uz/ru/arkhiv-kursov-valyut/json/all/${ymd}/`,
    `https://www.cbu.uz/ru/arkhiv-kursov-valyut/json/all/${ymd}/`,
  ];
}

const CBU_FETCH_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

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

function normalizeRates(raw: CbuRawRate[]): NormalizedRate[] {
  return raw
    .filter((r) => r.Ccy && VED_CURRENCIES_SET.has(r.Ccy))
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

/**
 * Забирает полный массив валют от ЦБ и оставляет только ВЭД-набор.
 * Бросает ошибку на сетевых/парсинг-ошибках.
 */
export async function fetchCbuRates(): Promise<NormalizedRate[]> {
  const urls = cbuFetchUrls();
  const errors: string[] = [];

  for (let round = 0; round < 2; round++) {
    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await fetch(url, {
          signal: controller.signal,
          headers: CBU_FETCH_HEADERS,
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const raw = (await resp.json()) as CbuRawRate[];
        if (!Array.isArray(raw)) {
          throw new Error('payload is not an array');
        }
        const normalized = normalizeRates(raw);
        if (normalized.length === 0) {
          throw new Error('no VED currencies in response');
        }
        return normalized;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${url}: ${msg}`);
      } finally {
        clearTimeout(timer);
      }
    }
    if (round === 0) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  throw new Error(errors.slice(-4).join(' | ') || 'CBU unreachable');
}
