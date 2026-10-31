import { describe, expect, it } from 'vitest';
import { buildAnalysis, monthsBetween, resolvePeriods, shiftYear, type ProductInfo, type SaleLine } from './category-analysis.service';

const product = (id: string, category: string, stock = 10): ProductInfo => ({
  id, name: id, sku: id, unit: 'кг', category, stock, minStock: 0, isActive: true,
});
const line = (day: string, productId: string, clientId: string, rev: number, qty: number, own = false): SaleLine => ({
  dealId: `${day}-${clientId}`, day, productId, clientId, managerId: 'm1', own, rev, qty,
});

describe('resolvePeriods', () => {
  it('ytd compares the same dates a year earlier', () => {
    expect(resolvePeriods('ytd', '2026-10-31')).toMatchObject({
      cur: { from: '2026-01-01', to: '2026-10-31' },
      prev: { from: '2025-01-01', to: '2025-10-31' },
    });
  });

  it('r12 periods touch without overlapping', () => {
    expect(resolvePeriods('r12', '2026-10-31')).toMatchObject({
      cur: { from: '2025-10-31', to: '2026-10-31' },
      prev: { from: '2024-10-31', to: '2025-10-30' },
    });
  });

  it('falls back to ytd when a custom range is missing', () => {
    expect(resolvePeriods('custom', '2026-10-31').kind).toBe('ytd');
  });

  it('shifts 29 February to 28 February', () => {
    expect(shiftYear('2028-02-29', -1)).toBe('2027-02-28');
  });

  it('lists months across a year boundary', () => {
    expect(monthsBetween('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('buildAnalysis', () => {
  const periods = resolvePeriods('ytd', '2026-10-31');
  const products = [product('paper', 'Бумага', 0), product('film', 'Плёнка')];
  const lines = [
    line('2025-03-01', 'paper', 'c1', 1000, 10),
    line('2025-04-01', 'film', 'c2', 500, 5),
    line('2026-03-01', 'film', 'c2', 900, 6),
    line('2026-03-02', 'film', 'own', 5000, 50, true),
  ];
  const run = (excludeOwn: boolean, category: string | null = null) => buildAnalysis({
    periods, lines, products, qty90: new Map([['film', 30]]), lastSale: new Map(), category, excludeOwn,
  });

  it('drops own companies when asked', () => {
    expect(run(true).totals).toMatchObject({ rev: 900, revPrev: 1500, clients: 1, clientsPrev: 2, lostClients: 1, revLost: 1000 });
    expect(run(false).totals.rev).toBe(5900);
  });

  it('counts revenue lost on out-of-stock products', () => {
    const paper = run(true).categories.find((c) => c.name === 'Бумага');
    expect(paper).toMatchObject({ rev: 0, revPrev: 1000, outOfStock: 1, lostToStockout: 1000 });
  });

  it('splits the change into volume, price, added and dropped', () => {
    const { priceVolume, totals } = run(true);
    // film: 5 кг по 100 → 6 кг по 150; paper пропала
    expect(priceVolume).toEqual({ volume: 100, price: 300, added: 0, dropped: -1000 });
    expect(priceVolume.volume + priceVolume.price + priceVolume.added + priceVolume.dropped).toBe(totals.rev - totals.revPrev);
  });

  it('scopes products and stock cover to the chosen category', () => {
    const a = run(true, 'Плёнка');
    expect(a.products.map((p) => p.id)).toEqual(['film']);
    expect(a.products[0]).toMatchObject({ abc: 'A', avgMonthlyQty: 10, coverMonths: 1, stockStatus: 'ok' });
    expect(a.categories).toHaveLength(2);
  });

  it('marks a product sold only last year and now at zero stock as out of stock', () => {
    expect(run(true, 'Бумага').products[0]).toMatchObject({ id: 'paper', stockStatus: 'out', rev: 0, revPrev: 1000 });
  });
});
