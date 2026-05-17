import { AppError } from '../errors';

const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Максимальная длина произвольного периода в аналитике (календарные дни, Asia/Tashkent). */
export const ANALYTICS_MAX_CUSTOM_DAYS = 366;

function tashkentDayStartUtc(y: number, monthIndex0: number, day: number): Date {
  return new Date(Date.UTC(y, monthIndex0, day) - TASHKENT_OFFSET);
}

function parseTashkentYmd(ymd: string, label: string): Date {
  const m = YMD_RE.exec(ymd.trim());
  if (!m) throw new AppError(400, `Некорректная дата ${label} (ожидается YYYY-MM-DD)`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) throw new AppError(400, `Некорректная дата ${label}`);
  const start = tashkentDayStartUtc(y, mo, d);
  const chk = new Date(start.getTime() + TASHKENT_OFFSET);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo || chk.getUTCDate() !== d) {
    throw new AppError(400, `Некорректная дата ${label}`);
  }
  return start;
}

/** Пресеты: неделя / месяц / квартал / год — границы по календарю Ташкента. */
export function getAnalyticsPresetPeriodRange(period: string): { start: Date; end: Date } {
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
  const y = nowTashkent.getUTCFullYear();
  const m = nowTashkent.getUTCMonth();
  const d = nowTashkent.getUTCDate();

  const startOfTodayUtc = new Date(Date.UTC(y, m, d) - TASHKENT_OFFSET);
  const end = new Date(startOfTodayUtc.getTime() + 86400000);
  let start: Date;

  switch (period) {
    case 'week':
      start = new Date(end.getTime() - 7 * 86400000);
      break;
    case 'quarter':
      start = new Date(Date.UTC(y, m - 3, d) - TASHKENT_OFFSET);
      break;
    case 'year':
      start = new Date(Date.UTC(y - 1, m, d) - TASHKENT_OFFSET);
      break;
    case 'month':
    default:
      start = new Date(Date.UTC(y, m, 1) - TASHKENT_OFFSET);
      break;
  }

  return { start, end };
}

/** Произвольный период: from/to включительно (конец дня to), end exclusive для SQL. */
export function getAnalyticsCustomPeriodRange(fromYmd: string, toYmd: string): { start: Date; end: Date } {
  const start = parseTashkentYmd(fromYmd, 'from');
  const lastDayStart = parseTashkentYmd(toYmd, 'to');
  if (lastDayStart < start) {
    throw new AppError(400, 'Дата «с» не может быть позже даты «по»');
  }
  const endExclusive = new Date(lastDayStart.getTime() + 86400000);
  const spanDays = Math.ceil((endExclusive.getTime() - start.getTime()) / 86400000);
  if (spanDays > ANALYTICS_MAX_CUSTOM_DAYS) {
    throw new AppError(400, `Интервал не более ${ANALYTICS_MAX_CUSTOM_DAYS} дней`);
  }
  return { start, end: endExclusive };
}

export function resolveAnalyticsPeriodRange(query: {
  period?: string;
  from?: string;
  to?: string;
}): { start: Date; end: Date } {
  const from = query.from?.trim();
  const to = query.to?.trim();
  if (from && to) return getAnalyticsCustomPeriodRange(from, to);
  if (from || to) {
    throw new AppError(400, 'Укажите обе даты from и to (YYYY-MM-DD)');
  }
  return getAnalyticsPresetPeriodRange(query.period || 'month');
}
