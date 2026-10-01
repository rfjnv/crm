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

/**
 * Всё, что не буква, не цифра и не пробел, — пунктуация: «М-Принт» находится по «мпринт»,
 * а `%`, `(`, `_`, `.*` ведут себя одинаково (запрос из одних символов = пустой запрос).
 */
const SEARCH_PUNCT_RE = /[^\p{L}\p{N}\s]/gu;

function normalizeWith(input: string, yoAsE: boolean): string {
  let s = (input || '').toLowerCase();
  if (yoAsE) s = s.replace(/ё/g, 'е');
  return toLatin(s)
    .replace(SEARCH_PUNCT_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Нормализация для поиска: регистр, ё→е, RU→EN транслит, без пунктуации, схлопнутые пробелы. */
export function normalizeSearch(input: string): string {
  return normalizeWith(input, true);
}

function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Цифры телефона для сравнения: «+998 94 620 90 92», «998946209092» и «94 620 90 92» → «946209092».
 * Неполный номер возвращается как есть (цифрами) — для поиска по подстроке.
 */
export function normalizePhone(input: string): string {
  const digits = digitsOnly(input || '');
  if (digits.length === 12 && digits.startsWith('998')) return digits.slice(3);
  return digits;
}

/** Запрос похож на номер телефона: только цифры, пробелы, скобки, «+», «-», «.» и хотя бы 5 цифр. */
function isPhoneQuery(query: string): boolean {
  return /^[\d\s()+\-.]+$/.test(query.trim()) && digitsOnly(query).length >= 5;
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
  const raw = haystack || '';
  const haystackDigits = digitsOnly(raw);
  // Номер целиком: «+998 94 620 90 92» должен находить «94 620 90 92», а не разбиваться на токены
  if (isPhoneQuery(query)) return haystackDigits.includes(normalizePhone(query));
  const haystackNorm = normalizeSearch(raw);
  // «Баёз» ищется и по «баез», и по латинскому «bayoz» — у названия с «ё» держим оба написания
  const haystackYo = /ё/i.test(raw) ? normalizeWith(raw, false) : '';
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => {
    if (haystackNorm.includes(token)) return true;
    if (haystackYo && haystackYo.includes(token)) return true;
    const tokenDigits = digitsOnly(token);
    // Formatted phones (+998 90 …) vs continuous digits (901234567)
    if (tokenDigits.length >= 5 && haystackDigits.includes(tokenDigits)) return true;
    return false;
  });
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
/** Haystack for client list / Select filters (company, contact, phone, inn, manager). */
export function buildClientSearchHaystack(parts: {
  companyName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  managerName?: string | null;
}): string {
  const phoneDigits = digitsOnly(parts.phone || '');
  return [
    parts.companyName,
    parts.contactName,
    parts.phone,
    phoneDigits,
    parts.email,
    parts.inn,
    parts.managerName,
  ]
    .filter((p): p is string => !!p)
    .join(' ');
}

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

/**
 * Проверка телефона клиента в форме. Пусто или один префикс «+998» — номера нет.
 * Узбекский — ровно 9 цифр после кода; иностранный (не +998) — 10–15 цифр.
 * Возвращает текст ошибки или null.
 */
export function validateClientPhone(value: string | null | undefined): string | null {
  const digits = digitsOnly(value || '');
  if (!digits || digits === '998') return null;
  const trimmed = (value || '').trim();
  const foreign = trimmed.startsWith('+') && !digits.startsWith('998');
  if (foreign) return digits.length >= 10 && digits.length <= 15 ? null : 'Некорректный номер';
  if (digits.length === 9 || (digits.length === 12 && digits.startsWith('998'))) return null;
  return 'Номер: +998 и 9 цифр';
}
