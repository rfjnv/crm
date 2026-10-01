import { describe, expect, it } from 'vitest';
import { createNameMatcher, nameTokens } from './timepay.matching';

const users = [
  { id: 'dilnoza', fullName: 'Дилноза Каримова' },
  { id: 'farhod', fullName: 'Фарход Алиев' },
  { id: 'shahzod', fullName: 'Шахзод Юсупов' },
  { id: 'fedor', fullName: 'Фёдор Ким' },
  { id: 'aziz1', fullName: 'Азиз Рахимов' },
  { id: 'aziz2', fullName: 'Азиз Рахимов' },
  { id: 'jasur', fullName: 'Жасур Тошматов' },
];
const match = createNameMatcher(users);

describe('nameTokens', () => {
  it('убирает отчество и «o‘g‘li / qizi»', () => {
    expect(nameTokens('Каримова Дилноза Алишеровна')).toEqual(['karimova', 'dilnoza']);
    expect(nameTokens("Yusupov Shaxzod Baxtiyor o'g'li")).toEqual(['yusupov', 'shahzod', 'bahtier']);
  });
});

describe('createNameMatcher', () => {
  it.each([
    ['Дилноза Каримова', 'dilnoza'],
    ['КАРИМОВА  Дилноза', 'dilnoza'],
    ['Каримова Дилноза Алишеровна', 'dilnoza'],
    ['Karimova Dilnoza', 'dilnoza'],
    ['Aliyev Farxod', 'farhod'],
    ['Алиев Фарход', 'farhod'],
    ['Yusupov Shaxzod', 'shahzod'],
    ['Юсупов Шахзод Бахтиёр угли', 'shahzod'],
    ['Федор Ким', 'fedor'],
    ['Toshmatov Jasur', 'jasur'],
    ['Юсупов Шахзод Бахтиёр', 'shahzod'],
  ])('%s → %s', (tpName, expected) => {
    expect(match(tpName)).toBe(expected);
  });

  it('однофамильцы-тёзки не сопоставляются наугад', () => {
    expect(match('Рахимов Азиз')).toBeNull();
  });

  it('одно совпавшее слово — не совпадение', () => {
    expect(match('Дилноза')).toBeNull();
    expect(match('Каримова Нигора')).toBeNull();
  });
});
