import { toLatin } from '../../lib/translit';

/**
 * Сопоставление сотрудника TimePay с пользователем CRM по ФИО.
 *
 * Раньше требовалось точное совпадение строки (после trim/lowercase), и из 35 сотрудников
 * находилось 3: в TimePay «Фамилия Имя Отчество», в CRM — «Имя Фамилия», где-то «ё»,
 * где-то латиница. Здесь имя приводится к набору слов в одной латинской записи без отчества,
 * а совпадение засчитывается, только если кандидат ровно один.
 */

/** Отчество / «сын, дочь» — в CRM их обычно не пишут. */
const PATRONYMIC_RE = /(ovich|evich|ovna|evna|ich|ichna|ogli|ugli|qizi|kizi)$/;
const PATRONYMIC_WORDS = new Set(['ogli', 'ugli', 'qizi', 'kizi']);

/** Одно слово в одной латинской записи: «Шахзод», «Shaxzod» и «Shakhzod» → «shahzod», «Aliyev» → «aliev». */
function squashWord(word: string): string {
  return toLatin(word.replace(/ё/g, 'е'))
    .replace(/['ʻʼ’`]/g, '')
    .replace(/kh/g, 'h')
    .replace(/x/g, 'h')
    .replace(/q/g, 'k')
    .replace(/ts/g, 'c')
    .replace(/zh|dj/g, 'j')
    .replace(/w/g, 'v')
    .replace(/yo/g, 'e') // «Baxtiyor» = «Бахтиёр» (ё уже сведена к е)
    .replace(/iy/g, 'i') // «Aliyev» = «Алиев»
    .replace(/[^a-z0-9]/g, '');
}

export function nameTokens(fullName: string): string[] {
  const words = fullName
    .toLowerCase()
    .split(/[\s.,;()\-/]+/)
    .map(squashWord)
    .filter((w) => w.length > 1);
  const withoutPatronymic = words.filter((w) => !PATRONYMIC_WORDS.has(w) && !PATRONYMIC_RE.test(w));
  // Если всё имя состоит из «отчеств» (редкая фамилия на -ич), не выбрасываем ничего
  return withoutPatronymic.length > 0 ? withoutPatronymic : words;
}

export interface MatchCandidate {
  id: string;
  fullName: string;
}

export function createNameMatcher(candidates: MatchCandidate[]) {
  const prepared = candidates.map((c) => ({ id: c.id, tokens: new Set(nameTokens(c.fullName)) }));

  const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));

  /** id пользователя CRM или null, если совпадений нет или их несколько. */
  return function match(timepayName: string): string | null {
    const tp = new Set(nameTokens(timepayName));
    if (tp.size === 0) return null;

    const exact = prepared.filter((c) => c.tokens.size === tp.size && isSubset(c.tokens, tp));
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1) return null;

    // «Дилноза Каримова» в CRM и «Каримова Дилноза Алишеровна» в TimePay — одно из имён
    // содержит другое целиком (минимум имя + фамилия)
    const partial = prepared.filter(
      (c) => Math.min(c.tokens.size, tp.size) >= 2 && (isSubset(c.tokens, tp) || isSubset(tp, c.tokens)),
    );
    return partial.length === 1 ? partial[0].id : null;
  };
}
