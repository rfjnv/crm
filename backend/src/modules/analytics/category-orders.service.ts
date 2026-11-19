/**
 * «Заказы и продажи по категориям»: помесячная динамика продаж рядом с приходами на склад,
 * заказами поставщикам и остатком — чтобы видеть, падали ли продажи перед заказом
 * (товар кончался) и вернулись ли после прихода.
 *
 * Чистые функции — без базы, их проверяют тесты.
 */

export interface MonthRow {
  month: string; // YYYY-MM
  rev: number;
  qty: number;
  deals: number;
  clients: number;
  /** Приход на склад (движения IN), в единицах товара */
  inQty: number;
  /** Заказано поставщику (импорт-заказы по дате заказа), в единицах товара */
  orderedQty: number;
  /** Остаток на конец месяца; null — нет данных */
  stock: number | null;
}

export type EventKind = 'arrival' | 'import';

export interface RestockEvent {
  kind: EventKind;
  month: string;
  /** Дата события (YYYY-MM-DD) */
  date: string;
  qty: number;
  /** Для импорт-заказа — номер и статус */
  number?: string;
  status?: string;
  eta?: string | null;
  /** Средняя выручка в месяц за 4 месяца «обычной жизни» (m-6…m-3) */
  baseline: number;
  /** Средняя выручка в месяц за 2 месяца перед событием (m-2, m-1) */
  before: number;
  /** Средняя выручка в месяц за 2 месяца после (m+1, m+2); null — ещё не прошли */
  after: number | null;
  /** before против baseline, %; null — нет базы */
  dropBefore: number | null;
  /** after против before, %; null — нет данных */
  recovery: number | null;
  /** Остаток на конец месяца перед событием */
  stockBefore: number | null;
  /** Продажи перед событием просели (≤ −20 %) */
  dipped: boolean;
  /** Перед событием товара почти не было (остаток меньше двух недель продаж) */
  stockedOut: boolean;
}

export const DIP_THRESHOLD = -20;

export function addMonths(month: string, k: number): string {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + k, 1));
  return d.toISOString().slice(0, 7);
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b - 1) * 1000) / 10 : null);

function avg(rows: Map<string, MonthRow>, months: string[], field: 'rev' | 'qty'): number | null {
  const got = months.map((m) => rows.get(m));
  if (got.some((r) => !r)) return null; // месяц вне окна данных
  return got.reduce((s, r) => s + (r as MonthRow)[field], 0) / months.length;
}

/**
 * Оценка одного события (приход / заказ) по помесячному ряду категории.
 * `today` — текущий месяц: он неполный, в «после» его не берём.
 */
export function rateEvent(
  series: MonthRow[],
  ev: { kind: EventKind; month: string; date: string; qty: number; number?: string; status?: string; eta?: string | null },
  currentMonth: string,
): RestockEvent | null {
  const rows = new Map(series.map((r) => [r.month, r]));
  const m = ev.month;
  const baseline = avg(rows, [-6, -5, -4, -3].map((k) => addMonths(m, k)), 'rev');
  const before = avg(rows, [-2, -1].map((k) => addMonths(m, k)), 'rev');
  if (before == null) return null; // событие у самого края окна — не с чем сравнить
  const afterMonths = [1, 2].map((k) => addMonths(m, k));
  const after = afterMonths.every((x) => x < currentMonth) ? avg(rows, afterMonths, 'rev') : null;
  const dropBefore = baseline != null ? pct(before, baseline) : null;
  const prev = rows.get(addMonths(m, -1));
  const stockBefore = prev?.stock ?? null;
  const qtyBefore = avg(rows, [-2, -1].map((k) => addMonths(m, k)), 'qty') ?? 0;
  const qtyBase = avg(rows, [-6, -5, -4, -3].map((k) => addMonths(m, k)), 'qty') ?? qtyBefore;
  const monthlyNeed = Math.max(qtyBefore, qtyBase);
  return {
    ...ev,
    baseline: baseline ?? 0,
    before,
    after,
    dropBefore,
    recovery: after != null ? pct(after, before) : null,
    stockBefore,
    dipped: dropBefore != null && dropBefore <= DIP_THRESHOLD,
    stockedOut: stockBefore != null && monthlyNeed > 0 && stockBefore < monthlyNeed / 2,
  };
}

/**
 * Месяцы прихода, которые стоит разбирать: приход после месяца без прихода.
 * Если товар приходит каждый месяц, «до заказа» не существует — берём только начала волн.
 */
export function arrivalStarts(series: MonthRow[]): MonthRow[] {
  return series.filter((r, i) => r.inQty > 0 && (i === 0 ? false : series[i - 1].inQty <= 0));
}

/** Изменение последних 3 полных месяцев против 3 до них, %. */
export function trend3(series: MonthRow[], currentMonth: string): { last3: number; prev3: number; change: number | null } {
  const full = series.filter((r) => r.month < currentMonth);
  const last3 = full.slice(-3).reduce((s, r) => s + r.rev, 0);
  const prev3 = full.slice(-6, -3).reduce((s, r) => s + r.rev, 0);
  return { last3, prev3, change: pct(last3, prev3) };
}

/**
 * Остаток на конец каждого месяца по снимкам движений (stock_after).
 * `snaps` — последний снимок товара в месяце; до первого снимка берём его stock_before.
 * Текущий месяц — живой остаток товара.
 */
export function stockByMonth(
  months: string[],
  snaps: { month: string; stockAfter: number; firstBefore: number | null }[],
  currentStock: number,
  currentMonth: string,
): (number | null)[] {
  const byMonth = new Map(snaps.map((s) => [s.month, s]));
  const sorted = [...snaps].sort((a, b) => a.month.localeCompare(b.month));
  const first = sorted[0];
  // Товар без движений — остаток всё время тот же, что сейчас
  let last: number | null = first ? first.firstBefore : currentStock;
  return months.map((m) => {
    if (m >= currentMonth) return currentStock;
    const s = byMonth.get(m);
    if (s) last = s.stockAfter;
    return last;
  });
}
