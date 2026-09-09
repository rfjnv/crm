import { config } from '../../lib/config';

/** Токен TimePay истёк/недействителен (401) — отличаем от прочих сетевых/HTTP-ошибок. */
export class TimePayAuthError extends Error {
  constructor(message = 'TimePay: токен недействителен или истёк (401)') {
    super(message);
    this.name = 'TimePayAuthError';
  }
}

export class TimePayApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'TimePayApiError';
  }
}

async function timepayRequest<T>(path: string, accessToken: string, params?: Record<string, string | number | undefined>): Promise<T> {
  // path может быть абсолютным URL (поле "next" в постраничном ответе TimePay) — тогда используем его как есть.
  const url = /^https?:\/\//i.test(path)
    ? new URL(path)
    : new URL(path.replace(/^\//, ''), `${config.timepay.apiBaseUrl.replace(/\/?$/, '/')}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (resp.status === 401) {
      throw new TimePayAuthError();
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new TimePayApiError(`TimePay HTTP ${resp.status}: ${body.slice(0, 300)}`, resp.status);
    }
    return (await resp.json()) as T;
  } catch (err) {
    if (err instanceof TimePayAuthError || err instanceof TimePayApiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TimePayApiError(`TimePay запрос не выполнен: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface TimePayDashboardEntry {
  [key: string]: unknown;
}

/** Достаём массив записей из ответа страницы, каким бы ключом он ни был обёрнут. */
function extractEntriesPage(data: unknown): TimePayDashboardEntry[] {
  if (Array.isArray(data)) return data as TimePayDashboardEntry[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results as TimePayDashboardEntry[];
    if (Array.isArray(obj.data)) return obj.data as TimePayDashboardEntry[];
  }
  return [];
}

/** Ссылка на следующую страницу в постраничном (DRF-style) ответе, если она есть. */
function extractNextLink(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const next = (data as Record<string, unknown>).next;
    if (typeof next === 'string' && next) return next;
  }
  return null;
}

/**
 * GET /terminals/v6/dashboard/list/ — детальный список по дашборду (кто пришёл/ушёл/опоздал за день).
 * Точная форма ответа не задокументирована — сервис timepay.service.ts разбирает её терпимо
 * (перебирает варианты названий полей) и логирует сырой пример при несовпадении.
 *
 * Фильтр по типу занятости НЕ задаём — иначе TimePay отдаёт только часть сотрудников
 * (напр. только месячный оклад), и в CRM у остальных посещаемости нет. На сайте TimePay фильтра нет.
 * Ответ может быть постраничным — идём по ссылкам "next", пока они есть.
 */
export async function fetchDashboardList(
  accessToken: string,
  params: { date: string; branch?: string; department?: string },
): Promise<TimePayDashboardEntry[]> {
  const all: TimePayDashboardEntry[] = [];
  let page: unknown = await timepayRequest<unknown>('terminals/v6/dashboard/list/', accessToken, {
    shift: 'all',
    shift_type: '',
    date: params.date,
    branch: params.branch,
    department: params.department,
  });

  const seen = new Set<string>();
  for (let guard = 0; guard < 100; guard += 1) {
    all.push(...extractEntriesPage(page));
    const next = extractNextLink(page);
    if (!next || seen.has(next)) break;
    seen.add(next);
    page = await timepayRequest<unknown>(next, accessToken);
  }
  return all;
}

export async function fetchDashboardStats(accessToken: string, date: string): Promise<unknown> {
  return timepayRequest('terminals/dashboard/stats/', accessToken, { date });
}
