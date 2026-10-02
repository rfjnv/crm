/**
 * Нерабочие дни для РОП-агента: воскресенье и праздники Узбекистана. По ним не
 * считаются оставшиеся рабочие дни в прогнозе, не приходят сигналы, а слабая
 * выручка в такой день не выдаётся за провал.
 *
 * Хайиты переносятся каждый год (по лунному календарю, дату объявляют указом) —
 * здесь ожидаемые даты; уточнить или добавить переносы можно в ROP_HOLIDAYS
 * («2027-03-10=Рамазан хайит,2027-03-11»).
 */

const FIXED: Record<string, string> = {
  '01-01': 'Новый год',
  '03-08': 'Женский день',
  '03-21': 'Навруз',
  '05-09': 'День памяти',
  '09-01': 'День независимости',
  '10-01': 'День учителя',
  '12-08': 'День Конституции',
};

const MOVABLE: Record<string, string> = {
  '2026-03-20': 'Рамазан хайит',
  '2026-05-27': 'Курбан хайит',
  '2027-03-10': 'Рамазан хайит',
  '2027-05-17': 'Курбан хайит',
};

function extraHolidays(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (process.env.ROP_HOLIDAYS ?? '').split(',')) {
    const [date, name] = part.split('=').map((s) => s.trim());
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) out[date] = name || 'Праздник';
  }
  return out;
}

/** Название праздника или null. ymd — YYYY-MM-DD по Ташкенту. */
export function holidayName(ymd: string): string | null {
  return extraHolidays()[ymd] ?? MOVABLE[ymd] ?? FIXED[ymd.slice(5)] ?? null;
}

/** Воскресенье или праздник. */
export function isDayOff(ymd: string): boolean {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay() === 0 || holidayName(ymd) !== null;
}

/** Подпись дня для модели: «воскресенье», «праздник: День учителя» или null. */
export function dayOffNote(ymd: string): string | null {
  const holiday = holidayName(ymd);
  if (holiday) return `праздник: ${holiday}`;
  return new Date(`${ymd}T00:00:00Z`).getUTCDay() === 0 ? 'воскресенье' : null;
}
