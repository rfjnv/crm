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
  const url = new URL(path.replace(/^\//, ''), `${config.timepay.apiBaseUrl.replace(/\/?$/, '/')}`);
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

/**
 * GET /terminals/v6/dashboard/list/ — детальный список по дашборду (кто пришёл/ушёл/опоздал за день).
 * Точная форма ответа не задокументирована — сервис timepay.service.ts разбирает её терпимо
 * (перебирает варианты названий полей) и логирует сырой пример при несовпадении.
 */
export async function fetchDashboardList(
  accessToken: string,
  params: { date: string; branch?: string; department?: string },
): Promise<TimePayDashboardEntry[]> {
  const data = await timepayRequest<unknown>('terminals/v6/dashboard/list/', accessToken, {
    shift: 'all',
    shift_type: '',
    employment_type: 'monthly',
    date: params.date,
    branch: params.branch,
    department: params.department,
  });
  if (Array.isArray(data)) return data as TimePayDashboardEntry[];
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).results)) {
    return (data as Record<string, unknown>).results as TimePayDashboardEntry[];
  }
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).data)) {
    return (data as Record<string, unknown>).data as TimePayDashboardEntry[];
  }
  return [];
}

export async function fetchDashboardStats(accessToken: string, date: string): Promise<unknown> {
  return timepayRequest('terminals/dashboard/stats/', accessToken, { date });
}
