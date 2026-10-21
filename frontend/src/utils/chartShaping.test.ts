import { describe, expect, it } from 'vitest';
import { findOutlierCap, shortenNames, truncateLabel } from './chartShaping';

describe('findOutlierCap', () => {
  it('находит один огромный месяц', () => {
    const r = findOutlierCap([20, 22, 25, 30, 26, 2900, 24, 21, 28, 31]);
    expect(r?.outliers).toEqual([2900]);
    expect(r?.cap).toBeCloseTo(31 * 1.2);
  });

  it('не трогает обычный разброс и сезонный пик', () => {
    expect(findOutlierCap([10, 12, 15, 30, 14, 11, 13, 40])).toBeNull();
    expect(findOutlierCap([0, 0, 5, 1000])).toBeNull(); // мало точек — не судим
  });

  it('находит два выброса подряд', () => {
    const r = findOutlierCap([10, 11, 12, 13, 12, 11, 500, 900]);
    expect(r?.outliers).toEqual([900, 500]);
  });
});

describe('shortenNames', () => {
  it('убирает общее начало названий', () => {
    const m = shortenNames([
      'Офсетная пластина СТСР ф: 510*400 / 0,15',
      'Офсетная пластина СТСР ф: 1030*790',
      'Офсетная пластина СТСР ф: 525*459',
    ]);
    expect(m.get('Офсетная пластина СТСР ф: 1030*790')).toBe('1030*790');
  });

  it('по целым словам и только если у всех что-то остаётся', () => {
    const m = shortenNames(['Офсетная пластина СТСР ф: 510', 'Офсетная пластина СТР ф: 890']);
    expect(m.get('Офсетная пластина СТР ф: 890')).toBe('СТР ф: 890');
    const same = shortenNames(['Бумага A4', 'Бумага A4 80г']);
    expect(same.get('Бумага A4')).toBe('Бумага A4');
  });

  it('короткое общее начало не режет', () => {
    const m = shortenNames(['Бумага A4', 'Бумага A3']);
    expect(m.get('Бумага A3')).toBe('Бумага A3');
  });
});

describe('truncateLabel', () => {
  it('обрезает с многоточием', () => {
    expect(truncateLabel('Плёнка для ламинации глянцевая', 12)).toBe('Плёнка для…');
    expect(truncateLabel('Клей', 12)).toBe('Клей');
  });
});
