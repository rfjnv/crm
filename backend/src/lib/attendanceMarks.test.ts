import { describe, expect, it } from 'vitest';
import { judgeDay } from './attendanceMarks';

/** Момент по Ташкенту (UTC+5). */
const at = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+05:00`);

describe('judgeDay', () => {
  it('day shift: late after 09:15, counted from 09:00', () => {
    expect(judgeDay({ checkIn: at('2026-10-10', '09:10') }).kind).toBe('ON_TIME');
    expect(judgeDay({ checkIn: at('2026-10-10', '09:33') })).toMatchObject({ kind: 'LATE', lateMinutes: 33 });
  });

  it('night shift: arrival from 15:00 is measured from 18:00', () => {
    expect(judgeDay({ checkIn: at('2026-10-10', '18:04') }).kind).toBe('ON_TIME');
    expect(judgeDay({ checkIn: at('2026-10-10', '17:19') }).kind).toBe('ON_TIME');
    expect(judgeDay({ checkIn: at('2026-10-10', '18:25') })).toMatchObject({ kind: 'LATE', lateMinutes: 25 });
  });

  it('a departure after midnight is not an early leave', () => {
    expect(judgeDay({ checkIn: at('2026-10-10', '18:04'), checkOut: at('2026-10-11', '02:48') }).earlyLeave).toBe(false);
    expect(judgeDay({ checkIn: at('2026-10-10', '09:00'), checkOut: at('2026-10-10', '17:17') }).earlyLeave).toBe(true);
  });
});
