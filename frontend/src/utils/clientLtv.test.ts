import { describe, expect, it } from 'vitest';
import { clientStatus, cohortRevenue, computeClientStats, median, topShare } from './clientLtv';

const now = new Date('2026-10-21T12:00:00Z');

describe('computeClientStats', () => {
  const [stats] = computeClientStats(
    [{ id: 'c1', companyName: 'ООО Тест', managerName: 'Аня', firstAt: '2025-01-10T00:00:00Z', lastAt: '2026-07-10T00:00:00Z', deals: 4 }],
    [
      { clientId: 'c1', year: 2025, month: 1, revenue: 100, deals: 1 },
      { clientId: 'c1', year: 2025, month: 9, revenue: 200, deals: 1 },
      { clientId: 'c1', year: 2026, month: 3, revenue: 300, deals: 1 },
      { clientId: 'c1', year: 2026, month: 7, revenue: 400, deals: 1 },
    ],
    now,
  );

  it('LTV, средний чек и срок жизни', () => {
    expect(stats.ltv).toBe(1000);
    expect(stats.avgCheck).toBe(250);
    expect(stats.lifetimeMonths).toBe(19); // январь 2025 — июль 2026
    expect(stats.cohort).toBe(2025);
  });

  it('промежуток между покупками и «пора напомнить»', () => {
    expect(stats.avgIntervalDays).toBe(182); // 546 дней / 3 промежутка
    expect(stats.daysSinceLast).toBe(103);
    expect(stats.status).toBe('cooling');
    expect(stats.overdue).toBe(false); // обычно раз в полгода — рано
  });

  it('последние 12 месяцев к предыдущим', () => {
    // ноябрь 2025 — октябрь 2026: март и июль 2026; ноябрь 2024 — октябрь 2025: январь и сентябрь 2025
    expect(stats.last12).toBe(700);
    expect(stats.prev12).toBe(300);
    expect(stats.trend12).toBeCloseTo(700 / 300 - 1);
  });

  it('частый покупатель, пропавший на два месяца, — пора напомнить', () => {
    const [s] = computeClientStats(
      [{ id: 'c2', companyName: 'X', managerName: null, firstAt: '2026-01-01T00:00:00Z', lastAt: '2026-08-15T00:00:00Z', deals: 15 }],
      [],
      now,
    );
    expect(s.avgIntervalDays).toBe(16);
    expect(s.overdue).toBe(true);
  });
});

describe('статус, Парето, медиана, когорты', () => {
  it('статус по давности последней покупки', () => {
    expect(clientStatus(10)).toBe('active');
    expect(clientStatus(120)).toBe('cooling');
    expect(clientStatus(400)).toBe('lost');
  });

  it('доля топ-20 % клиентов', () => {
    expect(topShare([800, 50, 50, 50, 50])).toBeCloseTo(0.8);
    expect(topShare([])).toBe(0);
  });

  it('медиана', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('выручка когорт по годам', () => {
    const stats = computeClientStats(
      [
        { id: 'a', companyName: 'A', managerName: null, firstAt: '2024-05-01T00:00:00Z', lastAt: '2026-01-01T00:00:00Z', deals: 2 },
        { id: 'b', companyName: 'B', managerName: null, firstAt: '2026-02-01T00:00:00Z', lastAt: '2026-02-01T00:00:00Z', deals: 1 },
      ],
      [],
      now,
    );
    const m = cohortRevenue(stats, [
      { clientId: 'a', year: 2024, month: 5, revenue: 10, deals: 1 },
      { clientId: 'a', year: 2026, month: 1, revenue: 30, deals: 1 },
      { clientId: 'b', year: 2026, month: 2, revenue: 5, deals: 1 },
    ]);
    expect(m.get(2024)?.get(2026)).toBe(30);
    expect(m.get(2026)?.get(2026)).toBe(5);
  });
});
