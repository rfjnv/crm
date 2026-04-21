// Small bidirectional transliteration helpers so searches tolerate
// RU<->EN typing (e.g. "m print" matches "м принт").

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // common non-Russian cyrillic letters (uzbek, ukrainian)
  і: 'i', ї: 'yi', є: 'ye', ў: 'u', қ: 'q', ғ: 'g', ҳ: 'h', ө: 'o',
};

// digraphs first, then single chars
const LAT_DIGRAPH_TO_CYR: Array<[string, string]> = [
  ['sch', 'щ'], ['shch', 'щ'],
  ['yo', 'ё'], ['jo', 'ё'],
  ['zh', 'ж'], ['kh', 'х'], ['ch', 'ч'], ['sh', 'ш'],
  ['yu', 'ю'], ['ju', 'ю'],
  ['ya', 'я'], ['ja', 'я'],
  ['ye', 'е'], ['ts', 'ц'],
];

const LAT_CHAR_TO_CYR: Record<string, string> = {
  a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х',
  i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'х',
  y: 'й', z: 'з',
};

export function toLatin(input: string): string {
  if (!input) return '';
  let out = '';
  for (const ch of input.toLowerCase()) {
    const mapped = CYR_TO_LAT[ch];
    out += mapped === undefined ? ch : mapped;
  }
  return out;
}

export function toCyrillic(input: string): string {
  if (!input) return '';
  let s = input.toLowerCase();
  for (const [lat, cyr] of LAT_DIGRAPH_TO_CYR) {
    s = s.split(lat).join(cyr);
  }
  let out = '';
  for (const ch of s) {
    const mapped = LAT_CHAR_TO_CYR[ch];
    out += mapped === undefined ? ch : mapped;
  }
  return out;
}

/** Normalizes a string for comparison: lowercased Latin form, collapsed whitespace. */
export function normalizeSearch(input: string): string {
  return toLatin(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Build distinct search variants for a query so DB `contains` can match
 * data typed in either alphabet. Collapses whitespace but preserves
 * internal spaces (so we also attempt the full phrase variant).
 */
export function buildSearchVariants(query: string): string[] {
  const base = query.replace(/\s+/g, ' ').trim();
  if (!base) return [];
  const variants = new Set<string>();
  variants.add(base);
  variants.add(toLatin(base));
  variants.add(toCyrillic(base));
  // also provide a "spaceless" merge so "m print" matches "mprint"
  const compact = base.replace(/\s+/g, '');
  if (compact !== base) {
    variants.add(compact);
    variants.add(toLatin(compact));
    variants.add(toCyrillic(compact));
  }
  return Array.from(variants).filter((v) => v.length > 0);
}

/** Tokens split by whitespace (each token independently searchable). */
export function buildSearchTokens(query: string): string[] {
  return query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
