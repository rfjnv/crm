import { describe, expect, it } from 'vitest';
import {
  checkArithmetic,
  matchRow,
  resolvePeriod,
  type CatalogProduct,
  type RawRow,
} from './payment-requests.match';

const LAM = 'Ламинационная пленка';
const lam = (sku: string, name: string): CatalogProduct => ({ id: sku, sku, name, unit: 'кг', category: LAM });

const catalog: CatalogProduct[] = [
  lam('лам62', 'Ламинационная пленка (глянцевая) ф:62'),
  lam('лам62 матт', 'Ламинационная пленка (матовая) ф:62'),
  lam('лам60 матт', 'Ламинационная пленка (матовая) ф:60'),
  lam('лам68 матт', 'Ламинационная пленка (матовая) ф:68'),
  lam('лам70 матт', 'Ламинационная пленка (матовая) ф:70'),
  lam('лам55', 'Ламинационная пленка (глянцевая) ф:55'),
  lam('лам58', 'Ламинационная пленка (глянцевая) ф:58'),
  lam('лам65', 'Ламинационная пленка (глянцевая) ф:65'),
  lam('лам50 силвер', 'Ламинационная пленка силвер ф:50'),
  { id: 'wash', sku: 'CHEM-WASH', name: 'Смывка для валов', unit: 'л', category: 'Химия' },
  { id: 'wash2', sku: 'WASH-5', name: 'Смывка 5л', unit: 'шт', category: 'Химия' },
  { id: 'uv400', sku: 'UV-PI400A', name: 'UV лак LANER PI-400A', unit: 'кг', category: 'UV лак' },
  { id: 'uv125', sku: 'UV-PI125', name: 'UV лак LANER PI-125', unit: 'кг', category: 'UV лак' },
  { id: 'paper', sku: 'MEL-62', name: 'Мелованная бумага глянц 62', unit: 'лист', category: 'Бумага' },
];

const row = (category: string, format: string | null, qty = 1, price: number | null = 43000, sum: number | null = null): RawRow => ({
  category, format, qty, price, sum, uncertain: false,
});

describe('matchRow', () => {
  it('матт и формат находят матовую плёнку этой ширины', () => {
    expect(matchRow(row('матт', '62'), catalog).product?.sku).toBe('лам62 матт');
  });

  it('глянц — это плёнка без пометки, а не матовая и не бумага', () => {
    expect(matchRow(row('глянц', '62'), catalog).product?.sku).toBe('лам62');
    expect(matchRow(row('глянц', '65'), catalog).product?.sku).toBe('лам65');
  });

  it('силвер находит свою плёнку', () => {
    expect(matchRow(row('силвер', '50', 35.1, 90000), catalog).product?.sku).toBe('лам50 силвер');
  });

  it('формата нет в каталоге: товар не выбирается, предлагается та же отделка', () => {
    const result = matchRow(row('матт', '84'), catalog);
    expect(result.product).toBeNull();
    expect(result.candidates.map((c) => c.sku)).toContain('лам62 матт');
    expect(result.candidates.map((c) => c.sku)).not.toContain('лам62');
  });

  it('несколько смывок: не угадывает, а предлагает выбрать', () => {
    const result = matchRow(row('смывка', null, 10, 50000), catalog);
    expect(result.product).toBeNull();
    expect(result.candidates.map((c) => c.id).sort()).toEqual(['wash', 'wash2']);
  });

  it('уф лак выбирается по формату', () => {
    expect(matchRow(row('уф лак', '125', 2, 115000), catalog).product?.id).toBe('uv125');
  });

  it('неизвестный товар: пусто, без случайных совпадений', () => {
    const result = matchRow(row('фольга', '360'), catalog);
    expect(result.product).toBeNull();
    expect(result.candidates).toEqual([]);
  });
});

describe('resolvePeriod', () => {
  const raw = (fd: number, fm: number, td: number, tm: number, year: number | null = null) => ({
    from_day: fd, from_month: fm, to_day: td, to_month: tm, year,
  });

  it('без года берёт текущий', () => {
    expect(resolvePeriod(raw(17, 8, 29, 8), '2026-11-06')).toEqual({ from: '2026-08-17', to: '2026-08-29' });
  });

  it('дата из будущего означает прошлый год', () => {
    expect(resolvePeriod(raw(10, 12, 20, 12), '2026-11-06')).toEqual({ from: '2025-12-10', to: '2025-12-20' });
  });

  it('период через Новый год', () => {
    expect(resolvePeriod(raw(28, 12, 3, 1), '2026-01-10')).toEqual({ from: '2025-12-28', to: '2026-01-03' });
  });

  it('год с фото важнее', () => {
    expect(resolvePeriod(raw(10, 8, 15, 8, 2025), '2026-11-06')).toEqual({ from: '2025-08-10', to: '2025-08-15' });
  });

  it('несуществующая или непрочитанная дата: null', () => {
    expect(resolvePeriod(raw(31, 2, 3, 3), '2026-11-06')).toBeNull();
    expect(resolvePeriod({ from_day: null, from_month: 8, to_day: 1, to_month: 9, year: null }, '2026-11-06')).toBeNull();
  });
});

describe('checkArithmetic на таблицах с фото', () => {
  const lines = (items: [string, string | null, number, number, number][]) =>
    items.map(([c, f, q, p, s]) => row(c, f, q, p, s));

  it('17.08–29.08 сходится с итогом 45 258 700', () => {
    const rows = lines([
      ['матт', '60', 54.6, 43000, 2347800],
      ['матт', '62', 85.7, 43000, 3685100],
      ['матт', '68', 343.7, 43000, 14779100],
      ['глянц', '55', 216, 43000, 9288000],
      ['глянц', '58', 110.2, 43000, 4738600],
      ['глянц', '65', 121.4, 43000, 5220200],
      ['глянц', '72', 35, 43000, 1505000],
      ['глянц', '78', 39, 43000, 1677000],
      ['глянц', '74', 35.3, 43000, 1517900],
      ['смывка', null, 10, 50000, 500000],
    ]);
    expect(checkArithmetic(rows, 45258700)).toEqual([]);
  });

  it('10.08–15.08 и 21.09–26.09 сходятся', () => {
    expect(checkArithmetic(lines([
      ['матт', '62', 56.3, 43000, 2420900],
      ['матт', '70', 96, 43000, 4128000],
      ['глянц', '58', 28, 43000, 1204000],
      ['смывка', null, 10, 50000, 500000],
    ]), 8252900)).toEqual([]);
    expect(checkArithmetic(lines([
      ['матт', '60', 165.8, 43000, 7129400],
      ['матт', '68', 31.3, 43000, 1345900],
      ['силвер', '50', 35.1, 90000, 3159000],
      ['смывка', null, 10, 50000, 500000],
    ]), 12134300)).toEqual([]);
  });

  it('неверно прочитанная цифра ловится', () => {
    const warnings = checkArithmetic([row('матт', '60', 64.6, 43000, 2347800)], 2347800);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('в таблице 2347800');
  });

  it('нет цены: предупреждает и не сверяет итог', () => {
    expect(checkArithmetic([row('фольга', '360', 2, null)], 500)).toEqual(['фольга 360: не прочитана цена']);
  });

  it('плохо читаемая строка попадает в предупреждения', () => {
    const warnings = checkArithmetic([{ ...row('матт', '60', 1, 43000, 43000), uncertain: true }], 43000);
    expect(warnings[0]).toContain('проверьте по фото');
  });
});
