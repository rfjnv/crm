import { afterEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types';
import {
  HIDDEN_MONEY,
  formatCount,
  formatFullNumber,
  formatMoneyCompact,
  formatPercent,
  formatShortNumber,
  formatUZS,
} from './currency';

const NBSP = ' ';

function asUser(moneyAccess: User['moneyAccess']) {
  useAuthStore.setState({ user: { moneyAccess } as User });
}

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe('formatMoneyCompact — пороги', () => {
  it.each([
    [1_897_406_478, '1,9', 'млрд'],
    [2_500_000_000, '2,5', 'млрд'],
    [1_000_000_000, '1', 'млрд'],
    [999_960_000, '1', 'млрд'],
    [681_200_000, '681', 'млн'],
    [100_000_000, '100', 'млн'],
    [12_400_000, '12,4', 'млн'],
    [1_000_000, '1', 'млн'],
  ])('%d → %s %s', (value, text, unit) => {
    const r = formatMoneyCompact(value);
    expect(r.text).toBe(text);
    expect(r.unit).toBe(unit);
    expect(r.hidden).toBe(false);
  });

  it('меньше миллиона — полностью, с пробелами, без единицы', () => {
    const r = formatMoneyCompact(48_250);
    expect(r).toMatchObject({ text: '48 250', unit: null, hidden: false });
  });

  it('полная сумма — для title и тултипа', () => {
    expect(formatMoneyCompact(1_897_406_478).full).toBe(formatFullNumber(1_897_406_478));
  });

  it('десятичный разделитель — запятая', () => {
    expect(formatMoneyCompact(12_400_000).text).toContain(',');
    expect(formatMoneyCompact(12_400_000).text).not.toContain('.');
  });

  it('отрицательные — со знаком минус', () => {
    expect(formatMoneyCompact(-12_400_000).text).toBe('−12,4');
  });

  it('строка и ноль', () => {
    expect(formatMoneyCompact('681200000').text).toBe('681');
    expect(formatMoneyCompact(0)).toMatchObject({ text: '0', unit: null, hidden: false });
  });
});

describe('formatMoneyCompact — скрытие сумм', () => {
  it('null и undefined (поле вырезал сервер) — маска', () => {
    expect(formatMoneyCompact(null)).toEqual({ text: HIDDEN_MONEY, unit: null, full: HIDDEN_MONEY, hidden: true });
    expect(formatMoneyCompact(undefined).hidden).toBe(true);
  });

  it('уровень NONE — маска, как у formatUZS', () => {
    asUser('NONE');
    expect(formatMoneyCompact(12_400_000)).toMatchObject({ text: HIDDEN_MONEY, hidden: true });
    expect(formatUZS(12_400_000)).toBe(HIDDEN_MONEY);
  });

  it('уровни FULL и NO_STRATEGIC — сумма видна', () => {
    asUser('FULL');
    expect(formatMoneyCompact(12_400_000).hidden).toBe(false);
    asUser('NO_STRATEGIC');
    expect(formatMoneyCompact(12_400_000).hidden).toBe(false);
  });
});

describe('formatPercent', () => {
  it('целое в барах', () => {
    expect(formatPercent(27.4, 0)).toBe(`27${NBSP}%`);
  });

  it('одна десятая с запятой в дельтах, со знаком', () => {
    expect(formatPercent(12.5, 1, { signed: true })).toBe(`+12,5${NBSP}%`);
    expect(formatPercent(-5.6, 1, { signed: true })).toBe(`−5,6${NBSP}%`);
  });

  it('ноль без знака', () => {
    expect(formatPercent(0, 1, { signed: true })).toBe(`0,0${NBSP}%`);
    expect(formatPercent(-0.01, 1, { signed: true })).toBe(`0,0${NBSP}%`);
  });

  it('пустое — прочерк', () => {
    expect(formatPercent(null, 0)).toBe('—');
    expect(formatPercent(Number.NaN, 1)).toBe('—');
  });
});

describe('formatCount — перенесён из дашборда без изменений', () => {
  it('разделитель тысяч и округление', () => {
    expect(formatCount(13572)).toBe((13572).toLocaleString('ru-RU'));
    expect(formatCount('12.6')).toBe('13');
    expect(formatCount('abc')).toBe('0');
  });
});

describe('старые хелперы не изменились', () => {
  it('formatFullNumber и formatShortNumber', () => {
    expect(formatFullNumber(1234567)).toBe('1 234 567 so’m');
    expect(formatShortNumber(12_400_000)).toBe('12.4 млн');
  });
});
