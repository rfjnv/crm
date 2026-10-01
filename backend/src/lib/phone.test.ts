import { describe, expect, it } from 'vitest';
import { canonicalClientPhone, formatUzPhone, phoneMatchKey, uzPhoneDigits } from './phone';

describe('uzPhoneDigits', () => {
  it.each([
    ['+998 94 620 90 92', '946209092'],
    ['946209092', '946209092'],
    ['998946209092', '946209092'],
    ['94 620 90 92', '946209092'],
    ['(90) 442-99-97', '904429997'],
    ['90-442-99-97', '904429997'],
    ['+998974209694', '974209694'],
  ])('%s → %s', (raw, expected) => {
    expect(uzPhoneDigits(raw)).toBe(expected);
  });

  it.each(['+7 701 123 45 67', '12345', '', '%', '9989462090921'])('не узбекский / неполный: %s', (raw) => {
    expect(uzPhoneDigits(raw)).toBeNull();
  });
});

describe('formatUzPhone', () => {
  it('приводит к формату формы CRM', () => {
    expect(formatUzPhone('946209092')).toBe('+998 94 620 90 92');
    expect(formatUzPhone('998946209092')).toBe('+998 94 620 90 92');
  });
});

describe('canonicalClientPhone', () => {
  it('узбекский номер — в едином формате', () => {
    expect(canonicalClientPhone(' 94 620 90 92 ')).toBe('+998 94 620 90 92');
  });
  it('иностранный не портит, только схлопывает пробелы', () => {
    expect(canonicalClientPhone('+7  701 123 45 67')).toBe('+7 701 123 45 67');
  });
  it('пустой → null', () => {
    expect(canonicalClientPhone('   ')).toBeNull();
    expect(canonicalClientPhone(null)).toBeNull();
  });
});

describe('phoneMatchKey', () => {
  it('один номер в разных записях даёт один ключ', () => {
    expect(phoneMatchKey('97 420 96 94')).toBe(phoneMatchKey('+998974209694'));
  });
});

describe('canonicalClientPhone: пустая форма', () => {
  it('один префикс +998 — номера нет', () => {
    expect(canonicalClientPhone('+998')).toBeNull();
    expect(canonicalClientPhone('+998 ')).toBeNull();
  });
});
