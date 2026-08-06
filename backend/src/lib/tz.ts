/**
 * Единый рабочий часовой пояс компании — Ташкент, UTC+5 (без перехода на летнее время).
 *
 * Раньше «Касса» раскладывала платежи по ташкентским суткам, а «Баланс компании» —
 * по UTC. Из-за этого любой платёж, принятый после 19:00 по Ташкенту, в двух отчётах
 * попадал в разные дни, и сверка между ними не сходилась никогда — особенно на границе
 * месяца. Любая логика «какой это день» обязана использовать этот модуль.
 */

export const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Ключ календарного дня по Ташкенту: 'YYYY-MM-DD'. */
export function tashkentDayKey(date: Date): string {
  return new Date(date.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Текущий момент, сдвинутый в ташкентское время (для извлечения Y/M/D через getUTC*). */
export function nowInTashkent(): Date {
  return new Date(Date.now() + TASHKENT_OFFSET_MS);
}

/** UTC-момент начала сегодняшних суток по Ташкенту. */
export function tashkentStartOfToday(): Date {
  const n = nowInTashkent();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - TASHKENT_OFFSET_MS);
}
