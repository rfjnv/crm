/**
 * Плашки HR в посещаемости и то, как они влияют на учёт дня.
 *
 * TimePay знает только время прихода и ухода. Почему человека не было, HR отмечает
 * плашкой: больничный и отпуск не должны считаться прогулом и резать KPI, а
 * «опоздал» без отметки в TimePay (забыл приложить карту) — должно.
 * Тот же список держит фронт: frontend/src/constants/attendanceMarks.ts.
 */

export const ATTENDANCE_MARKS = [
  'ABSENT',
  'LATE',
  'EARLY_LEAVE',
  'SICK',
  'VACATION',
  'DAY_OFF',
  'BUSINESS_TRIP',
  'REMOTE',
  'EXCUSED',
] as const;

export type AttendanceMark = (typeof ATTENDANCE_MARKS)[number];

/** День не рабочий для сотрудника: из нормы дней он выпадает. */
const EXCLUDED: AttendanceMark[] = ['SICK', 'VACATION', 'DAY_OFF'];
/** Работал, хотя TimePay мог его не увидеть: день засчитывается как «вовремя». */
const WORKED: AttendanceMark[] = ['BUSINESS_TRIP', 'REMOTE', 'EXCUSED'];

/** Рабочий день: начало 09:00, допуск 15 минут; при опоздании допуск сгорает целиком. */
export const WORK_START_MIN = 9 * 60;
export const GRACE_MIN = 15;
export const LATE_THRESHOLD_MIN = WORK_START_MIN + GRACE_MIN;
export const WORK_END_MIN = 18 * 60;

const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;

/** Минуты от начала дня по Ташкенту. */
export function minutesOfDayTashkent(d: Date): number {
  const t = new Date(d.getTime() + TASHKENT_OFFSET);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/** Номер календарного дня по Ташкенту — чтобы сравнивать даты двух моментов. */
function tashkentDay(d: Date): number {
  return Math.floor((d.getTime() + TASHKENT_OFFSET) / (24 * 60 * 60 * 1000));
}

export type DayKind = 'EXCLUDED' | 'ON_TIME' | 'LATE' | 'ABSENT';

export interface DayVerdict {
  kind: DayKind;
  lateMinutes: number;
  earlyLeave: boolean;
}

/** Итог одного дня с учётом плашек. Плашка HR важнее отметки TimePay. */
export function judgeDay(rec: { checkIn: Date | null; checkOut?: Date | null; marks?: string[] | null }): DayVerdict {
  const marks = (rec.marks ?? []) as AttendanceMark[];
  // Ушёл после полуночи (ночная смена) — по часам это «до 18:00», но раньше времени он не уходил.
  const overnight = !!rec.checkIn && !!rec.checkOut && tashkentDay(rec.checkOut) > tashkentDay(rec.checkIn);
  const earlyLeave =
    marks.includes('EARLY_LEAVE') ||
    (!!rec.checkOut && !overnight && !marks.some((m) => WORKED.includes(m)) && minutesOfDayTashkent(rec.checkOut) < WORK_END_MIN);

  if (marks.some((m) => EXCLUDED.includes(m))) return { kind: 'EXCLUDED', lateMinutes: 0, earlyLeave: false };
  if (marks.some((m) => WORKED.includes(m))) return { kind: 'ON_TIME', lateMinutes: 0, earlyLeave };
  if (marks.includes('ABSENT')) return { kind: 'ABSENT', lateMinutes: 0, earlyLeave: false };

  const minute = rec.checkIn ? minutesOfDayTashkent(rec.checkIn) : null;
  if (marks.includes('LATE')) {
    return { kind: 'LATE', lateMinutes: minute !== null && minute > WORK_START_MIN ? minute - WORK_START_MIN : 0, earlyLeave };
  }
  if (minute === null) return { kind: 'ABSENT', lateMinutes: 0, earlyLeave: false };
  if (minute <= LATE_THRESHOLD_MIN) return { kind: 'ON_TIME', lateMinutes: 0, earlyLeave };
  return { kind: 'LATE', lateMinutes: minute - WORK_START_MIN, earlyLeave };
}

export interface AttendanceSummary {
  /** Рабочих дней в месяце (пн–пт) минус больничные, отпуска и отгулы. */
  workdays: number;
  excluded: number;
  days: number;
  onTime: number;
  late: number;
  lateMinutes: number;
  absent: number;
  earlyLeave: number;
}

export function summarizeAttendance(
  records: { checkIn: Date | null; checkOut?: Date | null; marks?: string[] | null }[],
  monthWorkdays: number,
): AttendanceSummary {
  const s: AttendanceSummary = {
    workdays: monthWorkdays, excluded: 0, days: records.length,
    onTime: 0, late: 0, lateMinutes: 0, absent: 0, earlyLeave: 0,
  };
  for (const r of records) {
    const v = judgeDay(r);
    if (v.earlyLeave) s.earlyLeave += 1;
    if (v.kind === 'EXCLUDED') s.excluded += 1;
    else if (v.kind === 'ON_TIME') s.onTime += 1;
    else if (v.kind === 'ABSENT') s.absent += 1;
    else {
      s.late += 1;
      s.lateMinutes += v.lateMinutes;
    }
  }
  s.workdays = Math.max(0, monthWorkdays - s.excluded);
  return s;
}

/** Рабочих дней в месяце: понедельник–пятница. */
export function workdaysInMonth(year: number, month: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= days; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}
