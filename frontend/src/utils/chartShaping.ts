/**
 * Подготовка данных для графиков аналитики: выбросы и подписи.
 */

/**
 * Один огромный месяц (разовая крупная сделка, ошибка ввода) сплющивает весь график:
 * остальные столбцы превращаются в полоски у нуля. Находим такие значения и предлагаем
 * верхнюю границу оси, при которой видна обычная картина.
 *
 * Значение — выброс, если оно больше `factor` медиан ненулевых значений. Столбец не
 * пропадает: он упирается в границу, а настоящее число подписано. Возвращает null,
 * если выбросов нет.
 */
export function findOutlierCap(values: number[], factor = 5): { cap: number; outliers: number[] } | null {
  const positive = values.filter((v) => v > 0).sort((a, b) => b - a);
  if (positive.length < 4) return null;
  const median = positive[Math.floor(positive.length / 2)];
  let i = 0;
  // Не больше трёх выбросов: если их больше — это уже не выбросы, а сама картина
  while (i < 3 && i < positive.length - 3) {
    if (positive[i] > factor * median) i += 1;
    else break;
  }
  if (i === 0) return null;
  const cap = positive[i] * 1.2;
  return { cap, outliers: positive.slice(0, i) };
}

/**
 * У товаров одной категории названия часто начинаются одинаково («Офсетная пластина
 * СТСР ф: 510*400»). На графике оставляем отличающуюся часть, полное — в подсказке.
 * Общее начало берём по целым словам и только если после него у всех что-то остаётся.
 */
export function shortenNames(names: string[], minCommonWords = 2): Map<string, string> {
  const out = new Map<string, string>();
  const unique = [...new Set(names)];
  if (unique.length < 2) {
    for (const n of unique) out.set(n, n);
    return out;
  }
  const split = unique.map((n) => n.trim().split(/\s+/));
  let common = 0;
  for (;;) {
    const word = split[0][common];
    if (word == null || !split.every((w) => w.length > common + 1 && w[common] === word)) break;
    common += 1;
  }
  for (let i = 0; i < unique.length; i++) {
    out.set(unique[i], common >= minCommonWords ? split[i].slice(common).join(' ') : unique[i]);
  }
  return out;
}

/** Слово для сравнения начал: без регистра, «ё», знаков и окончания — «Самоклеющаяся» = «Самоклеящаяся». */
const stemWord = (w: string) => w.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 5);
const PREPOSITIONS = new Set(['в', 'во', 'на', 'для', 'с', 'со', 'из', 'по', 'под', 'и']);

/**
 * Как {@link shortenNames}, но общее начало ищется по большинству названий (≥ 60 %) и слова
 * сравниваются по первым буквам: опечатка или один товар с другим продолжением не отключают
 * сокращение для всей категории. Убираем не меньше двух слов и только если после них что-то остаётся.
 */
export function stripSharedStart(names: string[]): Map<string, string> {
  const out = new Map(names.map((n) => [n, n.trim()]));
  const unique = [...new Set(names)];
  if (unique.length < 2) return out;
  const words = unique.map((n) => n.trim().split(/\s+/));
  const need = Math.max(2, Math.ceil(unique.length * 0.8));
  const prefix: string[] = [];
  let pool = words.map((_, i) => i);
  for (;;) {
    const i = prefix.length;
    const counts = new Map<string, number>();
    // Название, которое кончается на этом слове, тоже «согласно» с началом — его просто не сократим
    for (const k of pool) {
      if (words[k].length <= i) continue;
      if (/\d/.test(words[k][i])) continue; // размеры и марки и есть отличие — их не убираем
      const s = stemWord(words[k][i]);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < need) break;
    prefix.push(best[0]);
    pool = pool.filter((k) => words[k].length > i && stemWord(words[k][i]) === best[0]);
  }
  // «в листах 300гр» читается, «листах 300гр» — нет: предлог оставляем с продолжением
  while (prefix.length && PREPOSITIONS.has(prefix[prefix.length - 1])) prefix.pop();
  if (prefix.length < 2) return out;
  unique.forEach((name, k) => {
    let n = 0;
    while (n < prefix.length && n < words[k].length && stemWord(words[k][n]) === prefix[n]) n += 1;
    if (n >= 2 && n < words[k].length) out.set(name, words[k].slice(n).join(' '));
  });
  return out;
}

/** Обрезает подпись до `max` символов с многоточием. */
export function truncateLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
