import { describe, expect, it } from 'vitest';
import { buildClientSearchHaystack, matchesSearch, normalizePhone, normalizeSearch, validateClientPhone } from './translit';

describe('normalizeSearch', () => {
  it('ё и е — одна буква', () => {
    expect(normalizeSearch('Баёз')).toBe(normalizeSearch('Баез'));
  });

  it('регистр, лишние пробелы и края', () => {
    expect(normalizeSearch('  Бекзод   АКА ')).toBe(normalizeSearch('бекзод ака'));
  });

  it.each(['%', '_', '(', '.*', '@', '%%', '( )'])('запрос из одних символов пустой: %s', (q) => {
    expect(normalizeSearch(q)).toBe('');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['+998 94 620 90 92', '946209092'],
    ['946209092', '946209092'],
    ['998946209092', '946209092'],
    ['(90) 442-99-97', '904429997'],
    ['90-442-99-97', '904429997'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });
});

const baez = buildClientSearchHaystack({ companyName: 'Баез', phone: '+998 97 420 96 94' });
const bayoz = buildClientSearchHaystack({ companyName: 'Баёз / Бекзод ака', phone: '+998974209694' });
const mediamax = buildClientSearchHaystack({ companyName: 'медиамакс', phone: '94 620 90 92' });
const mprint = buildClientSearchHaystack({ companyName: 'М-Принт', phone: '(90) 442-99-97' });

describe('matchesSearch', () => {
  it('«Баез» и «Баёз» находят обе карточки', () => {
    for (const q of ['Баез', 'Баёз', 'баез']) {
      expect(matchesSearch(baez, q)).toBe(true);
      expect(matchesSearch(bayoz, q)).toBe(true);
    }
  });

  it('латинский транслит «Bayoz» по-прежнему находит «Баёз»', () => {
    expect(matchesSearch(bayoz, 'Bayoz')).toBe(true);
  });

  it.each(['+998 94 620 90 92', '946209092', '998946209092', '94 620 90 92', '+998946209092'])(
    'телефон в любой записи: %s',
    (q) => {
      expect(matchesSearch(mediamax, q)).toBe(true);
    },
  );

  it.each(['(90) 442-99-97', '90-442-99-97', '904429997', '442-99'])('телефон со скобками и дефисами: %s', (q) => {
    expect(matchesSearch(mprint, q)).toBe(true);
  });

  it('чужой номер не находит', () => {
    expect(matchesSearch(mediamax, '+998 90 111 22 33')).toBe(false);
  });

  it.each(['%', '_', '(', '.*', '@'])('спецсимволы ведут себя как пустой запрос: %s', (q) => {
    expect(matchesSearch(mediamax, q)).toBe(true);
    expect(matchesSearch(baez, q)).toBe(true);
  });

  it('пунктуация в названии не мешает', () => {
    expect(matchesSearch(mprint, 'мпринт')).toBe(true);
    expect(matchesSearch(mprint, 'm print')).toBe(true);
  });
});

describe('validateClientPhone', () => {
  it.each(['', '+998', '+998 94 620 90 92', '946209092', '998946209092', '+7 701 123 45 67'])('ок: %s', (v) => {
    expect(validateClientPhone(v)).toBeNull();
  });
  it.each(['+998 94 620', '12345', '+998 94 620 90 92 1'])('ошибка: %s', (v) => {
    expect(validateClientPhone(v)).not.toBeNull();
  });
});
