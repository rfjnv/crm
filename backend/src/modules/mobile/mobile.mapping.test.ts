import { describe, expect, it } from 'vitest';
import {
  clientPhoneKeys,
  isConversation,
  isWorkingTime,
  mapMobileCall,
  needsCallback,
  splitClientPhones,
  workingMsBetween,
  type MobileCallType,
} from './mobile.mapping';

describe('mapMobileCall', () => {
  it.each<[MobileCallType, number, string, string]>([
    ['in', 184, 'INBOUND', 'COMPLETED'],
    ['out', 60, 'OUTBOUND', 'COMPLETED'],
    ['in', 0, 'INBOUND', 'MISSED'],
    ['out', 0, 'OUTBOUND', 'FAILED'],
    ['out_unanswered', 0, 'OUTBOUND', 'FAILED'],
    ['missed', 0, 'INBOUND', 'MISSED'],
    ['rejected', 0, 'INBOUND', 'MISSED'],
    ['blocked', 0, 'INBOUND', 'MISSED'],
    ['voicemail', 25, 'INBOUND', 'MISSED'],
    ['answered_externally', 0, 'INBOUND', 'COMPLETED'],
  ])('%s, %i с → %s / %s', (type, duration, direction, status) => {
    expect(mapMobileCall(type, duration)).toEqual({ direction, status });
  });

  it('перезванивать нужно на missed и rejected, но не на blocked и voicemail', () => {
    expect(['missed', 'rejected', 'blocked', 'voicemail', 'in', 'out'].filter(needsCallback)).toEqual(['missed', 'rejected']);
  });

  it('разговор — это in/out с длительностью больше 0', () => {
    expect(isConversation('out', 10)).toBe(true);
    expect(isConversation('in', 1)).toBe(true);
    expect(isConversation('out', 0)).toBe(false);
    expect(isConversation('out_unanswered', 30)).toBe(false);
    expect(isConversation('missed', 0)).toBe(false);
  });
});

describe('номера клиента', () => {
  it('в поле phone бывает несколько номеров через , ; /', () => {
    expect(splitClientPhones('+998 90 123 45 67, 91 222 33 44; (93) 555-66-77 / 998946209092')).toEqual([
      '+998 90 123 45 67', '91 222 33 44', '(93) 555-66-77', '998946209092',
    ]);
    expect(splitClientPhones(null)).toEqual([]);
  });

  it('ключи для сравнения с E.164 из приложения', () => {
    expect(clientPhoneKeys('+998 90 123 45 67, 91 222 33 44; (93) 555-66-77 / 998946209092')).toEqual([
      '901234567', '912223344', '935556677', '946209092',
    ]);
    // Служебные короткие номера не участвуют
    expect(clientPhoneKeys('1050')).toEqual([]);
  });
});

describe('рабочее время (Ташкент, UTC+5)', () => {
  const wh = { workStartHour: 9, workEndHour: 18, workDays: [1, 2, 3, 4, 5, 6] };
  // 2026-10-05 — понедельник; 09:00 по Ташкенту = 04:00 UTC
  const at = (iso: string) => new Date(iso);

  it('isWorkingTime', () => {
    expect(isWorkingTime(at('2026-10-05T04:00:00Z'), wh)).toBe(true); // пн 09:00
    expect(isWorkingTime(at('2026-10-05T03:59:00Z'), wh)).toBe(false); // пн 08:59
    expect(isWorkingTime(at('2026-10-05T13:00:00Z'), wh)).toBe(false); // пн 18:00
    expect(isWorkingTime(at('2026-10-04T06:00:00Z'), wh)).toBe(false); // воскресенье
  });

  it('ночь и выходной не считаются', () => {
    // сб 17:00 → пн 10:00: час в субботу и час в понедельник
    expect(workingMsBetween(at('2026-10-03T12:00:00Z'), at('2026-10-05T05:00:00Z'), wh)).toBe(2 * 3600_000);
    // пн 10:00 → пн 11:30
    expect(workingMsBetween(at('2026-10-05T05:00:00Z'), at('2026-10-05T06:30:00Z'), wh)).toBe(90 * 60_000);
    expect(workingMsBetween(at('2026-10-05T06:30:00Z'), at('2026-10-05T05:00:00Z'), wh)).toBe(0);
  });
});
