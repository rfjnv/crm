/**
 * Плашки HR в посещаемости. Тот же список и те же правила — на сервере:
 * backend/src/lib/attendanceMarks.ts (там же KPI и карточка сотрудника).
 */
export type AttendanceMark =
  | 'ABSENT'
  | 'LATE'
  | 'EARLY_LEAVE'
  | 'SICK'
  | 'VACATION'
  | 'DAY_OFF'
  | 'BUSINESS_TRIP'
  | 'REMOTE'
  | 'EXCUSED';

export interface AttendanceMarkMeta {
  key: AttendanceMark;
  label: string;
  color: string;
  /** Как плашка влияет на учёт дня — подсказка для HR. */
  hint: string;
}

export const ATTENDANCE_MARKS: AttendanceMarkMeta[] = [
  { key: 'ABSENT', label: 'Не пришёл', color: 'red', hint: 'прогул — считается пропуском' },
  { key: 'LATE', label: 'Опоздал', color: 'volcano', hint: 'считается опозданием, даже без отметки TimePay' },
  { key: 'EARLY_LEAVE', label: 'Ушёл раньше', color: 'orange', hint: 'ранний уход' },
  { key: 'SICK', label: 'Больничный', color: 'blue', hint: 'день не входит в норму, не прогул' },
  { key: 'VACATION', label: 'Отпуск', color: 'cyan', hint: 'день не входит в норму, не прогул' },
  { key: 'DAY_OFF', label: 'Отгул', color: 'geekblue', hint: 'день не входит в норму, не прогул' },
  { key: 'BUSINESS_TRIP', label: 'Командировка', color: 'purple', hint: 'работал — день вовремя' },
  { key: 'REMOTE', label: 'Удалённо', color: 'green', hint: 'работал — день вовремя' },
  { key: 'EXCUSED', label: 'Уважительная причина', color: 'lime', hint: 'опоздание или пропуск не учитывается' },
];

export const ATTENDANCE_MARK_META: Record<AttendanceMark, AttendanceMarkMeta> = Object.fromEntries(
  ATTENDANCE_MARKS.map((m) => [m.key, m]),
) as Record<AttendanceMark, AttendanceMarkMeta>;

/** День не входит в норму. */
export const EXCLUDED_MARKS: AttendanceMark[] = ['SICK', 'VACATION', 'DAY_OFF'];
/** Работал, хотя TimePay мог его не видеть. */
export const WORKED_MARKS: AttendanceMark[] = ['BUSINESS_TRIP', 'REMOTE', 'EXCUSED'];

/** Рабочий день компании: начало 09:00, допуск 15 минут, конец 18:00. */
export const WORK_START_MIN = 9 * 60;
export const GRACE_MIN = 15;
export const LATE_THRESHOLD_MIN = WORK_START_MIN + GRACE_MIN;
export const WORK_END_MIN = 18 * 60;

/**
 * Ночная смена: приход с 15:00 и позже — человек пришёл на смену с 18:00, а не опоздал на день.
 * Опоздание считаем от 18:00 с тем же допуском. Та же логика на сервере: backend/src/lib/attendanceMarks.ts.
 */
export const NIGHT_SHIFT_FROM_MIN = 15 * 60;
export const NIGHT_SHIFT_START_MIN = 18 * 60;

/** Начало смены по минуте прихода: 09:00 для дневной, 18:00 для ночной. */
export function shiftStartMin(checkInMin: number): number {
  return checkInMin >= NIGHT_SHIFT_FROM_MIN ? NIGHT_SHIFT_START_MIN : WORK_START_MIN;
}

export type DayKind = 'EXCLUDED' | 'ON_TIME' | 'LATE' | 'ABSENT';

/**
 * Итог дня с учётом плашек — копия judgeDay с сервера. Минуты прихода и ухода
 * передаются уже в часовом поясе компании.
 */
export function judgeDay(
  checkInMin: number | null,
  checkOutMin: number | null,
  rawMarks: string[] | undefined | null,
): { kind: DayKind; lateMinutes: number; earlyLeaveMinutes: number | null } {
  const marks = (rawMarks ?? []) as AttendanceMark[];
  const worked = marks.some((m) => WORKED_MARKS.includes(m));
  const earlyLeaveMinutes = marks.includes('EARLY_LEAVE')
    ? (checkOutMin !== null && checkOutMin < WORK_END_MIN ? WORK_END_MIN - checkOutMin : 0)
    : checkOutMin !== null && !worked && checkOutMin < WORK_END_MIN ? WORK_END_MIN - checkOutMin : null;

  if (marks.some((m) => EXCLUDED_MARKS.includes(m))) return { kind: 'EXCLUDED', lateMinutes: 0, earlyLeaveMinutes: null };
  if (worked) return { kind: 'ON_TIME', lateMinutes: 0, earlyLeaveMinutes };
  if (marks.includes('ABSENT')) return { kind: 'ABSENT', lateMinutes: 0, earlyLeaveMinutes: null };
  if (marks.includes('LATE')) {
    const start = checkInMin !== null ? shiftStartMin(checkInMin) : WORK_START_MIN;
    return { kind: 'LATE', lateMinutes: checkInMin !== null && checkInMin > start ? checkInMin - start : 0, earlyLeaveMinutes };
  }
  if (checkInMin === null) return { kind: 'ABSENT', lateMinutes: 0, earlyLeaveMinutes: null };
  const start = shiftStartMin(checkInMin);
  if (checkInMin <= start + GRACE_MIN) return { kind: 'ON_TIME', lateMinutes: 0, earlyLeaveMinutes };
  return { kind: 'LATE', lateMinutes: checkInMin - start, earlyLeaveMinutes };
}
