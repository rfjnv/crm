/**
 * Периоды для матриц активности клиентов: месяцы, недели, дни.
 *
 * Все даты — календарные дни Ташкента строкой `YYYY-MM-DD`; арифметика идёт в UTC,
 * чтобы часовой пояс браузера не сдвигал дни.
 *
 * Неделя здесь — кусок недели Пн–Вс внутри одного месяца: «1–6», «7–13», …, «28–30».
 * Так недели не перелезают через границу месяца, и сумма недель всегда равна месяцу.
 */

export type ActivityGranularity = 'month' | 'week' | 'day';

export type ActivityBucket = {
  /** month: `YYYY-MM`; week и day: первый день `YYYY-MM-DD`. */
  key: string;
  /** Первый и последний день периода включительно. */
  start: string;
  end: string;
  /** Короткая подпись колонки: «Сен», «7–13», «15». */
  label: string;
  /** Вторая строка подписи: день недели у дней. */
  sublabel?: string;
  /** Полное название для подсказок: «Сентябрь 2026», «7–13 сентября 2026», «пн, 15 сентября 2026». */
  title: string;
  /** Группа колонок: год у месяцев, месяц у недель, неделя у дней. */
  groupKey: string;
  groupLabel: string;
  weekend?: boolean;
  /** Сегодняшний день попадает в период. */
  current?: boolean;
  /** Период целиком в будущем. */
  future?: boolean;
};

export const GRANULARITY_LABELS: Record<ActivityGranularity, string> = {
  month: 'Месяцы',
  week: 'Недели',
  day: 'Дни',
};

/** Короткая единица для счётчиков: «3 мес.», «5 нед.», «12 дн.». */
export const GRANULARITY_UNIT: Record<ActivityGranularity, string> = {
  month: 'мес.',
  week: 'нед.',
  day: 'дн.',
};

const MONTH_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
export const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_GENITIVE_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

// ── Даты строкой ─────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(ymd: string, days: number): string {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDate(d);
}

/** Первый день месяца `YYYY-MM` → `YYYY-MM-01`. */
export function monthFirstDay(ym: string): string {
  return `${ym}-01`;
}

/** Последний день месяца `YYYY-MM`. */
export function monthLastDay(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return fromDate(new Date(Date.UTC(y, m, 0)));
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Сегодня по Ташкенту. */
export function todayTashkent(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
}

/** ISO-строка момента → календарный день Ташкента. */
export function tashkentDay(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
}

/** 0 = вс … 6 = сб */
function weekday(ymd: string): number {
  return toDate(ymd).getUTCDay();
}

function mondayOf(ymd: string): string {
  return addDays(ymd, -((weekday(ymd) + 6) % 7));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
}

// ── Подписи ──────────────────────────────────────────────────────────────────

/** «7–13 сентября 2026», «28 сентября – 4 октября 2026», «15 сентября 2026». */
export function rangeTitle(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (start === end) return `${sd} ${MONTH_GENITIVE[sm - 1]} ${sy}`;
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTH_GENITIVE[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTH_GENITIVE[sm - 1]} – ${ed} ${MONTH_GENITIVE[em - 1]} ${ey}`;
  return `${sd} ${MONTH_GENITIVE[sm - 1]} ${sy} – ${ed} ${MONTH_GENITIVE[em - 1]} ${ey}`;
}

function weekLabel(start: string, end: string): string {
  const sd = Number(start.slice(8));
  const ed = Number(end.slice(8));
  return sd === ed ? String(sd) : `${sd}–${ed}`;
}

// ── Ключ периода для дня ─────────────────────────────────────────────────────

/** В какой период попадает день: ключ совпадает с `ActivityBucket.key`. */
export function bucketKeyOf(day: string, granularity: ActivityGranularity): string {
  if (granularity === 'month') return day.slice(0, 7);
  if (granularity === 'day') return day;
  const monday = mondayOf(day);
  const first = monthFirstDay(day.slice(0, 7));
  return monday < first ? first : monday;
}

// ── Построение колонок ───────────────────────────────────────────────────────

/**
 * Периоды, покрывающие дни `from..to` включительно.
 * У месяцев границы — целые месяцы, в которые попадают `from` и `to`.
 */
export function buildBuckets(granularity: ActivityGranularity, from: string, to: string): ActivityBucket[] {
  const today = todayTashkent();
  const buckets: ActivityBucket[] = [];
  const mark = (b: ActivityBucket): ActivityBucket => ({
    ...b,
    current: b.start <= today && today <= b.end,
    future: b.start > today,
  });

  if (granularity === 'month') {
    const multiYear = from.slice(0, 4) !== to.slice(0, 4);
    for (let ym = from.slice(0, 7); ym <= to.slice(0, 7); ym = addMonths(ym, 1)) {
      const [y, m] = ym.split('-').map(Number);
      buckets.push(mark({
        key: ym,
        start: monthFirstDay(ym),
        end: monthLastDay(ym),
        label: multiYear ? `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}` : MONTH_SHORT[m - 1],
        title: monthTitle(ym),
        groupKey: String(y),
        groupLabel: String(y),
      }));
    }
    return buckets;
  }

  if (granularity === 'week') {
    let start = bucketKeyOf(from, 'week');
    while (start <= to) {
      const sunday = addDays(mondayOf(start), 6);
      const monthEnd = monthLastDay(start.slice(0, 7));
      const end = sunday < monthEnd ? sunday : monthEnd;
      const ym = start.slice(0, 7);
      buckets.push(mark({
        key: start,
        start,
        end,
        label: weekLabel(start, end),
        title: rangeTitle(start, end),
        groupKey: ym,
        groupLabel: monthTitle(ym),
      }));
      start = addDays(end, 1);
    }
    return buckets;
  }

  for (let day = from; day <= to; day = addDays(day, 1)) {
    const wd = weekday(day);
    const [y, m, d] = day.split('-').map(Number);
    const weekStart = bucketKeyOf(day, 'week');
    const sunday = addDays(mondayOf(day), 6);
    const monthEnd = monthLastDay(day.slice(0, 7));
    const weekEnd = sunday < monthEnd ? sunday : monthEnd;
    buckets.push(mark({
      key: day,
      start: day,
      end: day,
      label: String(d),
      sublabel: WEEKDAY_SHORT[wd],
      title: `${WEEKDAY_SHORT[wd]}, ${d} ${MONTH_GENITIVE[m - 1]} ${y}`,
      groupKey: weekStart,
      groupLabel: `${weekLabel(weekStart, weekEnd)} ${MONTH_GENITIVE_SHORT[m - 1]}`,
      weekend: wd === 0 || wd === 6,
    }));
  }
  return buckets;
}

/** Куски недель внутри месяца — для выбора недели в режиме «Дни». */
export function weeksOfMonth(ym: string): ActivityBucket[] {
  return buildBuckets('week', monthFirstDay(ym), monthLastDay(ym));
}

/**
 * Суммирует дневные значения по периодам: `[{date, revenue}]` → `Map<bucketKey, сумма>`.
 * `revenue: null` — сервер скрыл сумму (ограниченный доступ к деньгам); покупка всё равно
 * была, поэтому считаем её как 1, чтобы ячейка светилась.
 */
export function sumDaysByBucket(
  days: { date: string; revenue: number | null }[],
  granularity: ActivityGranularity,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const { date, revenue } of days) {
    const key = bucketKeyOf(date, granularity);
    out.set(key, (out.get(key) ?? 0) + (revenue ?? 1));
  }
  return out;
}
