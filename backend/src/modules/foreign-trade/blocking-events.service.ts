import Holidays from 'date-holidays';

export type BlockingCountryCode = 'CN' | 'TR' | 'GE' | 'RU' | 'KZ' | 'IR' | 'KG' | 'TM';

export interface SupportedBlockingCountry {
  code: BlockingCountryCode;
  label: string;
  isPrimary: boolean;
}

export interface BlockingCalendarEvent {
  id: string;
  countryCode: BlockingCountryCode;
  countryLabel: string;
  isPrimaryCountry: boolean;
  name: string;
  localName: string | null;
  date: string;
  startDate: string;
  endDate: string;
  type: string;
  source: 'date-holidays';
  note: string | null;
}

export interface BlockingCalendarResponse {
  from: string;
  to: string;
  countries: SupportedBlockingCountry[];
  items: BlockingCalendarEvent[];
}

type SupportedCountryDefinition = SupportedBlockingCountry & {
  holidayCode: string;
  aliases: string[];
};

type HolidayRow = {
  date?: string;
  start?: string | Date;
  end?: string | Date;
  name?: string;
  type?: string;
  substitute?: boolean;
};

const SUPPORTED_COUNTRIES: SupportedCountryDefinition[] = [
  {
    code: 'CN',
    holidayCode: 'CN',
    label: 'Китай',
    isPrimary: true,
    aliases: ['china', 'prc', 'китай', 'кнр'],
  },
  {
    code: 'TR',
    holidayCode: 'TR',
    label: 'Турция',
    isPrimary: true,
    aliases: ['turkey', 'turkiye', 'tuerkiye', 'турция'],
  },
  {
    code: 'GE',
    holidayCode: 'GE',
    label: 'Грузия',
    isPrimary: false,
    aliases: ['georgia', 'грузия'],
  },
  {
    code: 'RU',
    holidayCode: 'RU',
    label: 'Россия',
    isPrimary: false,
    aliases: ['russia', 'russian federation', 'россия', 'рф'],
  },
  {
    code: 'KZ',
    holidayCode: 'KZ',
    label: 'Казахстан',
    isPrimary: false,
    aliases: ['kazakhstan', 'казахстан'],
  },
  {
    code: 'IR',
    holidayCode: 'IR',
    label: 'Иран',
    isPrimary: false,
    aliases: ['iran', 'исламская республика иран', 'иран'],
  },
  {
    code: 'KG',
    holidayCode: 'KG',
    label: 'Кыргызстан',
    isPrimary: false,
    aliases: ['kyrgyzstan', 'kyrgyz republic', 'кыргызстан', 'киргизия', 'кыргызыстан'],
  },
  {
    code: 'TM',
    holidayCode: 'TM',
    label: 'Туркменистан',
    isPrimary: false,
    aliases: ['turkmenistan', 'туркменистан'],
  },
];

const COUNTRY_BY_CODE = new Map<BlockingCountryCode, SupportedCountryDefinition>(
  SUPPORTED_COUNTRIES.map((country) => [country.code, country]),
);

const COUNTRY_ALIAS_TO_CODE = new Map<string, BlockingCountryCode>();
for (const country of SUPPORTED_COUNTRIES) {
  for (const alias of [country.code, country.label, ...country.aliases]) {
    COUNTRY_ALIAS_TO_CODE.set(normalizeCountryKey(alias), country.code);
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

function parseDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function toDateOnly(value: string | Date | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function listYears(from: string, to: string): number[] {
  const fromYear = parseDateOnly(from).getUTCFullYear();
  const toYear = parseDateOnly(to).getUTCFullYear();
  const years: number[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    years.push(year);
  }
  return years;
}

function resolveCountryCodes(values?: string[]): BlockingCountryCode[] {
  if (!values || values.length === 0) {
    return SUPPORTED_COUNTRIES.map((country) => country.code);
  }

  const resolved = values
    .map((value) => normalizeBlockingCountry(value))
    .filter((value): value is BlockingCountryCode => Boolean(value));

  return [...new Set(resolved)];
}

export function normalizeBlockingCountry(raw?: string | null): BlockingCountryCode | null {
  if (!raw) return null;
  return COUNTRY_ALIAS_TO_CODE.get(normalizeCountryKey(raw)) ?? null;
}

export function listSupportedBlockingCountries(): SupportedBlockingCountry[] {
  return SUPPORTED_COUNTRIES.map(({ code, label, isPrimary }) => ({ code, label, isPrimary }));
}

export function listBlockingEvents(params: {
  from: string;
  to: string;
  countries?: string[];
}): BlockingCalendarResponse {
  const { from, to } = params;
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error('Invalid range: from must be before or equal to to');
  }

  const selectedCodes = resolveCountryCodes(params.countries);
  const years = listYears(from, to);
  const seen = new Set<string>();
  const items: BlockingCalendarEvent[] = [];

  for (const countryCode of selectedCodes) {
    const country = COUNTRY_BY_CODE.get(countryCode);
    if (!country) continue;

    const holidays = new Holidays(country.holidayCode);
    holidays.setLanguages('en');

    for (const year of years) {
      const rows = holidays.getHolidays(year) as HolidayRow[];
      for (const row of rows) {
        const type = String(row.type ?? '').toLowerCase();
        if (!['public', 'bank'].includes(type)) continue;

        const date = toDateOnly(row.date);
        if (!date || date < from || date > to) continue;

        const startDate = toDateOnly(row.start) ?? date;
        const endDate = toDateOnly(row.end) ?? date;
        const eventName = String(row.name ?? '').trim();
        if (!eventName) continue;

        const uniqueKey = `${countryCode}|${date}|${eventName}`;
        if (seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);

        items.push({
          id: uniqueKey,
          countryCode,
          countryLabel: country.label,
          isPrimaryCountry: country.isPrimary,
          name: eventName,
          localName: null,
          date,
          startDate,
          endDate,
          type,
          source: 'date-holidays',
          note: row.substitute ? 'Перенесенный / observed holiday' : null,
        });
      }
    }
  }

  items.sort((a, b) => (
    a.date.localeCompare(b.date)
    || Number(b.isPrimaryCountry) - Number(a.isPrimaryCountry)
    || a.countryLabel.localeCompare(b.countryLabel, 'ru')
    || a.name.localeCompare(b.name, 'ru')
  ));

  return {
    from,
    to,
    countries: listSupportedBlockingCountries(),
    items,
  };
}
