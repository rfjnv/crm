// Small bidirectional transliteration helpers so every client-side
// search input / Select filter tolerates RU<->EN typing
// (e.g. "m print" matches "м принт").

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ў: 'u', қ: 'q', ғ: 'g', ҳ: 'h', ө: 'o',
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

export function normalizeSearch(input: string): string {
  return toLatin(input || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Token-aware fuzzy matcher — splits the query by whitespace and
 * requires every token to appear (substring) in the normalized haystack.
 * Both sides are normalized with `toLatin` so Cyrillic ↔ Latin
 * typing returns the same matches.
 *
 *   matchesSearch('М Принт', 'm print')  → true
 *   matchesSearch('Megapaper', 'мега')   → true
 */
export function matchesSearch(haystack: string | null | undefined, query: string): boolean {
  if (!query || !query.trim()) return true;
  const haystackNorm = normalizeSearch(haystack || '');
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => haystackNorm.includes(token));
}

/**
 * Drop-in replacement for Ant Design `filterOption` that understands
 * both alphabets AND space-separated tokens.
 *
 *     <Select filterOption={smartFilterOption} ... />
 *
 * Compares the user's input against the option's `label` (or `children`
 * when that's a plain string) as well as the raw `value`.
 */
export function smartFilterOption(
  input: string,
  option: unknown,
): boolean {
  if (!input) return true;
  const opt = option as
    | { label?: unknown; value?: unknown; children?: unknown; title?: unknown }
    | undefined;
  if (!opt) return false;
  const candidates: string[] = [];
  const pick = (v: unknown) => {
    if (typeof v === 'string') candidates.push(v);
    else if (typeof v === 'number') candidates.push(String(v));
  };
  pick(opt.label);
  pick(opt.value);
  pick(opt.children);
  pick(opt.title);
  if (candidates.length === 0) return false;
  return candidates.some((c) => matchesSearch(c, input));
}

/**
 * Same as `smartFilterOption` but lets caller provide a custom
 * haystack builder (e.g. to include phone / inn / city / etc.).
 */
export function makeSmartFilterOption<TOption>(
  haystackFor: (option: TOption) => string | Array<string | null | undefined>,
) {
  return (input: string, option: TOption): boolean => {
    if (!input) return true;
    if (!option) return false;
    const raw = haystackFor(option);
    const pieces = Array.isArray(raw) ? raw : [raw];
    const merged = pieces.filter((p): p is string => !!p).join(' ');
    return matchesSearch(merged, input);
  };
}
