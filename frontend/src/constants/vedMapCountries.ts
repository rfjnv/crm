import type { VedCountryCode } from '../types';
import { normalizeVedCountry } from '../utils/vedBlockingCalendar';

/** English country names for VED map / supplier geography (stored value). */
export const VED_MAP_COUNTRIES_EN = [
  'Australia',
  'Bangladesh',
  'Belgium',
  'Brazil',
  'China',
  'Czech Republic',
  'Egypt',
  'France',
  'Germany',
  'Georgia',
  'Hong Kong',
  'India',
  'Indonesia',
  'Iran',
  'Italy',
  'Japan',
  'Kazakhstan',
  'Kyrgyzstan',
  'Macau',
  'Malaysia',
  'Netherlands',
  'Pakistan',
  'Poland',
  'Russia',
  'Singapore',
  'South Korea',
  'Spain',
  'Taiwan',
  'Thailand',
  'Turkey',
  'Turkmenistan',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uzbekistan',
  'Vietnam',
] as const;

export type VedMapCountryEn = (typeof VED_MAP_COUNTRIES_EN)[number];

export const VED_MAP_COUNTRY_OPTIONS = VED_MAP_COUNTRIES_EN.map((name) => ({
  value: name,
  label: name,
}));

const CODE_TO_ENGLISH: Record<VedCountryCode, VedMapCountryEn> = {
  CN: 'China',
  TR: 'Turkey',
  GE: 'Georgia',
  RU: 'Russia',
  KZ: 'Kazakhstan',
  IR: 'Iran',
  KG: 'Kyrgyzstan',
  TM: 'Turkmenistan',
};

const RUSSIAN_TO_ENGLISH: Record<string, VedMapCountryEn> = {
  китай: 'China',
  кнр: 'China',
  турция: 'Turkey',
  грузия: 'Georgia',
  россия: 'Russia',
  рф: 'Russia',
  казахстан: 'Kazakhstan',
  иран: 'Iran',
  кыргызстан: 'Kyrgyzstan',
  киргизия: 'Kyrgyzstan',
  туркменистан: 'Turkmenistan',
  узбекистан: 'Uzbekistan',
  вьетнам: 'Vietnam',
  индия: 'India',
  индонезия: 'Indonesia',
  оаэ: 'United Arab Emirates',
  германия: 'Germany',
  сша: 'United States',
  корея: 'South Korea',
  'южная корея': 'South Korea',
  япония: 'Japan',
  тайвань: 'Taiwan',
  тайланд: 'Thailand',
  таиланд: 'Thailand',
  малайзия: 'Malaysia',
  польша: 'Poland',
  италия: 'Italy',
  нидерланды: 'Netherlands',
  голландия: 'Netherlands',
  бельгия: 'Belgium',
  испания: 'Spain',
  великобритания: 'United Kingdom',
  англия: 'United Kingdom',
  франция: 'France',
};

function normalizeKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Show country in English on map labels (keeps unknown values as-is). */
export function displayCountryEnglish(country: string | null | undefined): string {
  if (!country?.trim()) return '';
  const trimmed = country.trim();
  const code = normalizeVedCountry(trimmed);
  if (code) return CODE_TO_ENGLISH[code];
  const fromList = VED_MAP_COUNTRIES_EN.find(
    (c) => normalizeKey(c) === normalizeKey(trimmed),
  );
  if (fromList) return fromList;
  const fromRu = RUSSIAN_TO_ENGLISH[normalizeKey(trimmed)];
  if (fromRu) return fromRu;
  return trimmed;
}
