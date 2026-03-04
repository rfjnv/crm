/**
 * Client name normalization utility.
 *
 * Ensures that client names with the same words in different order
 * produce the same normalized key for matching purposes.
 *
 * Steps:
 *   1. Lowercase, trim, collapse whitespace
 *   2. Remove punctuation
 *   3. Transliterate Latin → Cyrillic (full transliteration, not just homoglyphs)
 *   4. Remove legal prefixes (ООО, ИП, МЧЖ, LLC, etc.)
 *   5. Remove location words (Андижан, Ташкент, etc.)
 *   6. Tokenize and sort alphabetically
 *
 * Examples:
 *   "ООО Носир Кредо"       → "кредо носир"
 *   "Носир Кредо"           → "кредо носир"
 *   "кредо носир"           → "кредо носир"
 *   "Nosir Kredo"           → "кредо носир"
 *   "ИП Носир Кредо"        → "кредо носир"
 *   "Кредо Носир Андижан"   → "кредо носир"
 *   "nosir  kredo"          → "кредо носир"
 */

/**
 * Latin digraphs → Cyrillic (order matters: check digraphs before single chars).
 */
const LATIN_DIGRAPHS: [string, string][] = [
  ['sh', 'ш'],
  ['ch', 'ч'],
  ['ts', 'ц'],
  ['ya', 'я'],
  ['yu', 'ю'],
  ['yo', 'ё'],
  ['zh', 'ж'],
  ['kh', 'х'],
];

/**
 * Full Latin single-character → Cyrillic transliteration map (lowercase).
 * Covers standard Uzbek Latin and common English spellings.
 */
const LATIN_SINGLE: Record<string, string> = {
  'a': 'а',
  'b': 'б',
  'c': 'ц',
  'd': 'д',
  'e': 'е',
  'f': 'ф',
  'g': 'г',
  'h': 'х',
  'i': 'и',
  'j': 'ж',
  'k': 'к',
  'l': 'л',
  'm': 'м',
  'n': 'н',
  'o': 'о',
  'p': 'п',
  'q': 'к',
  'r': 'р',
  's': 'с',
  't': 'т',
  'u': 'у',
  'v': 'в',
  'w': 'в',
  'x': 'х',
  'y': 'й',
  'z': 'з',
};

/**
 * Legal prefixes / entity type words to strip from client names.
 * Listed in Cyrillic (post-transliteration form).
 */
const STOP_WORDS = new Set([
  // Russian / Uzbek Cyrillic
  'ооо', 'ип', 'мчж', 'ок', 'ук',
  // Latin legal forms (transliterated to Cyrillic)
  'мчхж',           // mchj → мчхж
  'кк',             // qk
  'хк',             // xk
  'ллц',            // llc
  'лтд',            // ltd
  'инц',            // inc
  'цорп',           // corp
  'цомпанй',        // company
  'цо',             // co
]);

/**
 * Location / city words to strip (in Cyrillic, post-transliteration).
 */
const LOCATION_WORDS = new Set([
  'андижан',   // андижан / andijan
  'ташкент',   // ташкент / tashkent
  'самарканд', // самарканд / samarkand
  'бухара',    // бухара / bukhara
  'наманган',  // наманган / namangan
  'фергана',   // фергана / fergana
  'навои',     // навои / navoi
  'нукус',     // нукус / nukus
  'карши',     // карши / karshi (note: transliterated as каршхи — also add)
  'каршхи',
  'коканд',    // коканд / kokand
  'ташкент',
]);

/**
 * Transliterate a lowercase string from Latin to Cyrillic.
 * Handles digraphs first (sh→ш, ch→ч, etc.), then single characters.
 * Characters that are already Cyrillic pass through unchanged.
 */
function transliterate(s: string): string {
  // Replace digraphs first
  let result = s;
  for (const [latin, cyrillic] of LATIN_DIGRAPHS) {
    result = result.split(latin).join(cyrillic);
  }

  // Replace remaining single Latin characters
  let out = '';
  for (const ch of result) {
    out += LATIN_SINGLE[ch] ?? ch;
  }
  return out;
}

/**
 * Basic string normalization: trim, collapse whitespace, lowercase.
 */
export function normLower(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normalize a client name for matching:
 *   1. Lowercase, trim, collapse whitespace
 *   2. Remove punctuation (quotes, dots, commas, dashes, etc.)
 *   3. Transliterate Latin → Cyrillic (full transliteration)
 *   4. Tokenize into words
 *   5. Remove stop words (legal prefixes)
 *   6. Remove location words
 *   7. Sort remaining tokens alphabetically
 *   8. Join with single space
 *
 * The original client name in the database is never modified —
 * this key is only used for matching / deduplication.
 */
export function normalizeClientName(name: unknown): string {
  if (name == null) return '';

  let s = String(name).trim().toLowerCase();

  // Remove punctuation: quotes "" «» '', dots, commas, dashes, parentheses, etc.
  s = s.replace(/["""«»''.,;:!?()\-–—/\\#№@&+*_=~`^|<>[\]{}]/g, ' ');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // Transliterate Latin → Cyrillic (converts all Latin chars to Cyrillic)
  s = transliterate(s);

  // Tokenize
  let tokens = s.split(' ').filter(Boolean);

  // Remove stop words (legal prefixes)
  tokens = tokens.filter((t) => !STOP_WORDS.has(t));

  // Remove location words
  tokens = tokens.filter((t) => !LOCATION_WORDS.has(t));

  // If all tokens were removed (edge case), fall back to the cleaned string
  if (tokens.length === 0) {
    tokens = s.split(' ').filter(Boolean);
  }

  // Sort alphabetically and join
  tokens.sort();
  return tokens.join(' ');
}
