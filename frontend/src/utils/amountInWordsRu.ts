/** Целое число 0..999_999_999 прописью (для сумм в накладных). */
export function integerAmountInWordsRu(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'ноль';
  if (n === 0) return 'ноль';
  if (n >= 1_000_000_000) return String(Math.floor(n));

  const onesM = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const onesF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = [
    'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
    'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
  ];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  const triadToWords = (num: number, female: boolean): string => {
    const o = female ? onesF : onesM;
    if (num === 0) return '';
    let s = '';
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const u = num % 10;
    if (h) s += `${hundreds[h]} `;
    if (t === 1) s += `${teens[u]} `;
    else {
      if (t) s += `${tens[t]} `;
      if (u) s += `${o[u]} `;
    }
    return s.trim();
  };

  const millForm = (n: number): string => {
    const m100 = n % 100;
    const m10 = n % 10;
    if (m100 >= 11 && m100 <= 14) return 'миллионов';
    if (m10 === 1) return 'миллион';
    if (m10 >= 2 && m10 <= 4) return 'миллиона';
    return 'миллионов';
  };

  const thouForm = (n: number): string => {
    const m100 = n % 100;
    const m10 = n % 10;
    if (m100 >= 11 && m100 <= 14) return 'тысяч';
    if (m10 === 1) return 'тысяча';
    if (m10 >= 2 && m10 <= 4) return 'тысячи';
    return 'тысяч';
  };

  const mil = Math.floor(n / 1_000_000);
  const thou = Math.floor((n % 1_000_000) / 1000);
  const hun = n % 1000;

  const parts: string[] = [];
  if (mil) parts.push(`${triadToWords(mil, false)} ${millForm(mil)}`.trim());
  if (thou) parts.push(`${triadToWords(thou, true)} ${thouForm(thou)}`.trim());
  if (hun || n === 0) {
    const w = triadToWords(hun, false);
    if (w) parts.push(w);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
