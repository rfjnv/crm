import { describe, expect, it } from 'vitest';
import { buildBuckets, bucketKeyOf, sumDaysByBucket, weeksOfMonth, rangeTitle, addMonths, monthLastDay } from './activityPeriods';

describe('activityPeriods', () => {
  it('режет недели по границам месяца', () => {
    // Сентябрь 2026: 1-е — вторник, 30-е — среда
    const weeks = weeksOfMonth('2026-09');
    expect(weeks.map((w) => w.label)).toEqual(['1–6', '7–13', '14–20', '21–27', '28–30']);
    expect(weeks[0]).toMatchObject({ start: '2026-09-01', end: '2026-09-06', groupKey: '2026-09' });
    expect(weeks[4]).toMatchObject({ start: '2026-09-28', end: '2026-09-30' });
  });

  it('недели нескольких месяцев идут без пропусков и наложений', () => {
    const weeks = buildBuckets('week', '2026-08-01', '2026-10-31');
    for (let i = 1; i < weeks.length; i++) {
      const prevEnd = new Date(`${weeks[i - 1].end}T00:00:00Z`).getTime();
      const start = new Date(`${weeks[i].start}T00:00:00Z`).getTime();
      expect(start - prevEnd).toBe(86_400_000);
    }
    expect(weeks[0].start).toBe('2026-08-01');
    expect(weeks[weeks.length - 1].end).toBe('2026-10-31');
  });

  it('ключ дня совпадает с ключом колонки', () => {
    expect(bucketKeyOf('2026-09-30', 'week')).toBe('2026-09-28');
    expect(bucketKeyOf('2026-10-01', 'week')).toBe('2026-10-01');
    expect(bucketKeyOf('2026-10-04', 'week')).toBe('2026-10-01');
    expect(bucketKeyOf('2026-10-05', 'week')).toBe('2026-10-05');
    expect(bucketKeyOf('2026-10-05', 'month')).toBe('2026-10');
  });

  it('дни: выходные и группа по неделе', () => {
    const days = buildBuckets('day', '2026-10-01', '2026-10-05');
    expect(days.map((d) => d.sublabel)).toEqual(['чт', 'пт', 'сб', 'вс', 'пн']);
    expect(days.filter((d) => d.weekend).map((d) => d.key)).toEqual(['2026-10-03', '2026-10-04']);
    expect(days[0].groupLabel).toBe('1–4 окт');
    expect(days[4].groupKey).toBe('2026-10-05');
  });

  it('месяцы через год подписаны с годом', () => {
    const months = buildBuckets('month', '2025-11-01', '2026-02-28');
    expect(months.map((m) => m.label)).toEqual(['Ноя 25', 'Дек 25', 'Янв 26', 'Фев 26']);
    expect(months[1]).toMatchObject({ start: '2025-12-01', end: '2025-12-31', groupKey: '2025' });
  });

  it('суммирует дни, скрытую сумму считает покупкой', () => {
    const sums = sumDaysByBucket([
      { date: '2026-09-28', revenue: 100 },
      { date: '2026-09-30', revenue: 50 },
      { date: '2026-10-01', revenue: null },
    ], 'week');
    expect(sums.get('2026-09-28')).toBe(150);
    expect(sums.get('2026-10-01')).toBe(1);
  });

  it('подписи периодов', () => {
    expect(rangeTitle('2026-09-07', '2026-09-13')).toBe('7–13 сентября 2026');
    expect(rangeTitle('2026-09-15', '2026-09-15')).toBe('15 сентября 2026');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthLastDay('2028-02')).toBe('2028-02-29');
  });
});
