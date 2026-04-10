/**
 * Дата закрытия сделки: если в названии есть DD.MM.YYYY в конце (часто после «—»),
 * используем её как «бизнес-дату» (полдень по Ташкенту), иначе — fallback (фактическое время закрытия).
 */

const TITLE_DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Календарный день в Ташкенте → границы в UTC. ymd = YYYY-MM-DD */
export function tashkentDayBoundsFromYmd(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) {
    throw new Error(`Invalid ymd: ${ymd}`);
  }
  const start = new Date(`${y}-${pad2(m)}-${pad2(d)}T00:00:00.000+05:00`);
  const end = new Date(`${y}-${pad2(m)}-${pad2(d)}T23:59:59.999+05:00`);
  return { start, end };
}

export function currentTashkentYmd(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
}

/**
 * Ищет дату DD.MM.YYYY в конце названия сделки.
 * Возвращает Date (полдень Asia/Tashkent) или null.
 */
export function parseClosedDateFromDealTitle(title: string): Date | null {
  const t = (title || '').trim();
  const m = t.match(TITLE_DATE_RE);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 2000 || yyyy > 2100) return null;
  const iso = `${yyyy}-${pad2(mm)}-${pad2(dd)}T12:00:00.000+05:00`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  const back = dt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
  const expected = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
  if (back !== expected) return null;
  return dt;
}

/** Фактическое время закрытия/отгрузки — не из даты в названии (она про дату создания сделки). */
export function resolveClosedAtForNewClose(_deal: { title: string }, fallback: Date): Date {
  return fallback;
}
