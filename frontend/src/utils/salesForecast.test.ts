import { describe, expect, it } from 'vitest';
import { bestMonth, buildSeries, forecastYear, seasonalPeakMonth, yearOverYear, type YearSeries } from './salesForecast';

function months(values: Record<number, number>): number[] {
  return Array.from({ length: 12 }, (_, i) => values[i + 1] ?? 0);
}

describe('buildSeries', () => {
  it('складывает строки по ключу, году и месяцу', () => {
    const series = buildSeries(
      [
        { year: 2025, month: 3, cat: 'A', v: 10 },
        { year: 2025, month: 3, cat: 'A', v: 5 },
        { year: 2026, month: 1, cat: 'B', v: 7 },
      ],
      (r) => r.cat,
      (r) => r.v,
    );
    expect(series.get('A')!.get(2025)![2]).toBe(15);
    expect(series.get('B')!.get(2026)![0]).toBe(7);
  });
});

describe('forecastYear', () => {
  const ctx = { year: 2026, nowYear: 2026, nowMonth: 4 };

  it('строит прогноз по среднему прошлых лет с поправкой на темп года', () => {
    const series: YearSeries = new Map([
      [2024, months({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 200 })],
      [2025, months({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 400 })],
      // Закрытые январь—март вдвое выше прошлых лет
      [2026, months({ 1: 200, 2: 200, 3: 200, 4: 50 })],
    ]);
    const f = forecastYear(series, ctx);
    expect(f.trend).toBe(2);
    expect(f.forecast.slice(0, 3)).toEqual([null, null, null]);
    expect(f.forecast[3]).toBe(200); // апрель: 100 × 2
    expect(f.forecast[4]).toBe(600); // май: (200 + 400) / 2 × 2
    // В апреле уже продано 50 — ждём ещё 150, плюс май 600
    expect(f.restOfYear).toBe(750);
    expect(f.basedOnYears).toEqual([2024, 2025]);
  });

  it('не учитывает годы, когда товар ещё не продавался', () => {
    const series: YearSeries = new Map([
      [2024, months({})],
      [2025, months({ 5: 300 })],
      [2026, months({})],
    ]);
    const f = forecastYear(series, { year: 2026, nowYear: 2026, nowMonth: 1 });
    expect(f.basedOnYears).toEqual([2025]);
    expect(f.forecast[4]).toBe(300);
    expect(f.trend).toBeNull();
  });

  it('не прогнозирует закрытый год и товар без истории', () => {
    const series: YearSeries = new Map([[2025, months({ 1: 10 })]]);
    expect(forecastYear(series, { year: 2025, nowYear: 2026, nowMonth: 4 }).forecast.every((v) => v === null)).toBe(true);
    expect(forecastYear(new Map([[2026, months({ 1: 10 })]]), ctx).forecast.every((v) => v === null)).toBe(true);
  });

  it('один огромный месяц не раздувает темп года', () => {
    const series: YearSeries = new Map([
      [2025, months({ 1: 100, 2: 100, 3: 100, 4: 100 })],
      // Март — разовая сделка в 50 раз больше обычного
      [2026, months({ 1: 100, 2: 100, 3: 5000 })],
    ]);
    const f = forecastYear(series, ctx);
    expect(f.trend).toBeCloseTo((100 + 100 + 300) / 300);
    expect(f.forecast[3]).toBe(167);
  });

  it('темп не выше чем втрое', () => {
    const series: YearSeries = new Map([
      [2025, months({ 1: 10, 2: 10, 3: 10, 4: 10 })],
      [2026, months({ 1: 50, 2: 60, 3: 70 })],
    ]);
    expect(forecastYear(series, ctx).trend).toBe(3);
  });
});

describe('сезонность и сравнение', () => {
  const now = { nowYear: 2026, nowMonth: 3 };
  const series: YearSeries = new Map([
    [2025, months({ 2: 50, 9: 300 })],
    // Март 2026 ещё не закончился — в пик не входит
    [2026, months({ 2: 100, 3: 900 })],
  ]);

  it('пик сезона — по средним за закрытые месяцы', () => {
    expect(seasonalPeakMonth(series, now)).toBe(9);
  });

  it('лучший месяц — по факту', () => {
    expect(bestMonth(series.get(2026)!)).toBe(3);
    expect(bestMonth(months({}))).toBeNull();
  });

  it('рост к прошлому году — только за закрытые месяцы', () => {
    expect(yearOverYear(series, { year: 2026, ...now })).toBeCloseTo(100 / 50 - 1);
    expect(yearOverYear(series, { year: 2025, ...now })).toBeNull();
  });
});
