import { describe, expect, it } from 'vitest';
import { arrivalStarts, monthRange, rateEvent, stockByMonth, trend3, type MonthRow } from './category-orders.service';

const row = (month: string, rev: number, extra: Partial<MonthRow> = {}): MonthRow => ({
  month, rev, qty: rev / 10, deals: 1, clients: 1, inQty: 0, orderedQty: 0, stock: 100, ...extra,
});

describe('category-orders', () => {
  it('monthRange crosses the year', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('flags a sales dip and empty stock before an arrival, and the recovery after', () => {
    const months = monthRange('2026-01', '2026-10');
    const revs = [100, 100, 100, 100, 50, 30, 0, 120, 110, 100];
    const series = months.map((m, i) => row(m, revs[i], { stock: i === 5 ? 1 : 100, inQty: i === 6 ? 500 : 0 }));
    const ev = rateEvent(series, { kind: 'arrival', month: '2026-07', date: '2026-07-05', qty: 500 }, '2026-11');
    expect(ev).not.toBeNull();
    expect(ev!.baseline).toBe(100); // янв–апр
    expect(ev!.before).toBe(40); // май–июн
    expect(ev!.dropBefore).toBe(-60);
    expect(ev!.dipped).toBe(true);
    expect(ev!.stockedOut).toBe(true);
    expect(ev!.after).toBe(115);
    expect(ev!.recovery).toBe(187.5);
  });

  it('does not judge the months that have not finished yet', () => {
    const series = monthRange('2026-01', '2026-11').map((m) => row(m, 100));
    const ev = rateEvent(series, { kind: 'arrival', month: '2026-10', date: '2026-10-01', qty: 1 }, '2026-11');
    expect(ev!.after).toBeNull();
    expect(ev!.dipped).toBe(false);
  });

  it('arrivalStarts keeps only the first month of a run of arrivals', () => {
    const s = monthRange('2026-01', '2026-06').map((m, i) => row(m, 1, { inQty: [0, 5, 5, 0, 3, 0][i] }));
    expect(arrivalStarts(s).map((r) => r.month)).toEqual(['2026-02', '2026-05']);
  });

  it('trend3 compares the last three full months with the three before', () => {
    const s = monthRange('2026-05', '2026-11').map((m, i) => row(m, [10, 10, 10, 20, 20, 20, 999][i]));
    expect(trend3(s, '2026-11')).toEqual({ last3: 60, prev3: 30, change: 100 });
  });

  it('stockByMonth carries snapshots forward and uses the live stock for this month', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
    expect(stockByMonth(months, [{ month: '2026-02', stockAfter: 5, firstBefore: 9 }], 7, '2026-04')).toEqual([9, 5, 5, 7]);
    expect(stockByMonth(months, [], 7, '2026-04')).toEqual([7, 7, 7, 7]);
  });
});
