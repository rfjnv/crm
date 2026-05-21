import type { Dictionary } from './seed/dictionaries';

export type SiteLocale = 'ru' | 'uz' | 'en';

export type ContentRow = {
  locale: SiteLocale;
  section: string;
  key: string;
  value: string;
};

const SKIP_PREFIXES: Record<string, string[]> = {
  services: ['items'],
  products: ['items'],
  blog: ['posts'],
};

function shouldSkip(section: string, keyPath: string): boolean {
  const skips = SKIP_PREFIXES[section];
  if (!skips) return false;
  return skips.some((p) => keyPath === p || keyPath.startsWith(`${p}.`));
}

function flattenValue(
  locale: SiteLocale,
  section: string,
  keyPath: string,
  value: unknown,
  out: ContentRow[],
): void {
  if (shouldSkip(section, keyPath)) return;

  if (typeof value === 'string') {
    out.push({ locale, section, key: keyPath, value });
    return;
  }

  if (Array.isArray(value)) {
    out.push({ locale, section, key: keyPath, value: JSON.stringify(value) });
    return;
  }

  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = keyPath ? `${keyPath}.${k}` : k;
      flattenValue(locale, section, next, v, out);
    }
  }
}

export function dictionaryToContentRows(locale: SiteLocale, dict: Dictionary): ContentRow[] {
  const rows: ContentRow[] = [];
  for (const [section, data] of Object.entries(dict)) {
    flattenValue(locale, section, '', data, rows);
  }
  return rows;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `post-${Date.now()}`;
}
