import dayjs from 'dayjs';
import type { BlockingHolidayEvent, VedCountryCode } from '../types';

const COUNTRY_ALIASES: Record<VedCountryCode, string[]> = {
  CN: ['cn', 'china', 'prc', 'китай', 'кнр'],
  TR: ['tr', 'turkey', 'turkiye', 'tuerkiye', 'турция'],
  GE: ['ge', 'georgia', 'грузия'],
  RU: ['ru', 'russia', 'russian federation', 'россия', 'рф'],
  KZ: ['kz', 'kazakhstan', 'казахстан'],
  IR: ['ir', 'iran', 'исламская республика иран', 'иран'],
  KG: ['kg', 'kyrgyzstan', 'kyrgyz republic', 'кыргызстан', 'киргизия', 'кыргызыстан'],
  TM: ['tm', 'turkmenistan', 'туркменистан'],
};

const COUNTRY_ALIAS_TO_CODE = new Map<string, VedCountryCode>();
for (const [code, aliases] of Object.entries(COUNTRY_ALIASES) as [VedCountryCode, string[]][]) {
  for (const alias of aliases) {
    COUNTRY_ALIAS_TO_CODE.set(normalizeCountryKey(alias), code);
  }
}

function normalizeCountryKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeVedCountry(raw?: string | null): VedCountryCode | null {
  if (!raw) return null;
  return COUNTRY_ALIAS_TO_CODE.get(normalizeCountryKey(raw)) ?? null;
}

export function groupBlockingEventsByDate(events: BlockingHolidayEvent[]): Map<string, BlockingHolidayEvent[]> {
  const byDate = new Map<string, BlockingHolidayEvent[]>();
  for (const event of events) {
    const key = event.date;
    const current = byDate.get(key);
    if (current) {
      current.push(event);
    } else {
      byDate.set(key, [event]);
    }
  }
  return byDate;
}

export function getBlockingHitsForDate(
  date: string | null | undefined,
  eventsByDate: Map<string, BlockingHolidayEvent[]>,
  countryCode: VedCountryCode | null,
): BlockingHolidayEvent[] {
  if (!date || !countryCode) return [];
  const key = dayjs(date).format('YYYY-MM-DD');
  return (eventsByDate.get(key) ?? []).filter((event) => event.countryCode === countryCode);
}

export function uniqueCountryCodes(events: BlockingHolidayEvent[]): VedCountryCode[] {
  return [...new Set(events.map((event) => event.countryCode))];
}
