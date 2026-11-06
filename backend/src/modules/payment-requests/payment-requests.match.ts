import { LAMINATION_CATEGORY } from '../../lib/lamination';

/**
 * Разбор того, что модель прочитала с фото таблицы: период и какому товару каталога
 * соответствует строка вроде «матт 62». Модель только читает таблицу, а выбор товара
 * и все проверки здесь — обычный код, его можно проверить тестами.
 */

export interface RawPeriod {
  from_day: number | null;
  from_month: number | null;
  to_day: number | null;
  to_month: number | null;
  /** Только если год написан на фото, обычно его нет. */
  year: number | null;
}

export interface RawRow {
  category: string;
  format: string | null;
  qty: number;
  price: number | null;
  sum: number | null;
  uncertain: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string | null;
}

export type ProductRef = Pick<CatalogProduct, 'id' | 'name' | 'sku' | 'unit'>;

export interface MatchedRow extends RawRow {
  product: ProductRef | null;
  /** Варианты на выбор, если однозначно определить товар не удалось. */
  candidates: ProductRef[];
}

const MAX_CANDIDATES = 20;

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Года на фото обычно нет: берём ближайший не из будущего. Период через Новый год
 * («28.12–03.01») заканчивается уже в следующем году.
 */
export function resolvePeriod(raw: RawPeriod, today: string): { from: string; to: string } | null {
  const { from_day: fd, from_month: fm, to_day: td, to_month: tm } = raw;
  if (!fd || !fm || !td || !tm) return null;

  const crossesYear = tm < fm || (tm === fm && td < fd);
  let fromYear = raw.year ?? Number(today.slice(0, 4));
  if (raw.year == null) {
    const candidate = validDate(fromYear, fm, fd);
    if (candidate && candidate > today) fromYear -= 1;
  }
  const from = validDate(fromYear, fm, fd);
  const to = validDate(crossesYear ? fromYear + 1 : fromYear, tm, td);
  return from && to ? { from, to } : null;
}

type Finish = 'матт' | 'глянец' | 'силвер' | 'голд';

const low = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

function finishOfRow(category: string): Finish | null {
  const c = low(category);
  if (/мат|matt|mate/.test(c)) return 'матт';
  if (/гл[яе]н|gloss/.test(c)) return 'глянец';
  if (/силв|silv/.test(c)) return 'силвер';
  if (/голд|gold/.test(c)) return 'голд';
  return null;
}

/** В каталоге глянец без пометки: «лам65» — глянец, «лам62 матт» — матовая. */
function finishOfProduct(p: CatalogProduct): Finish | null {
  const text = low(`${p.sku} ${p.name}`);
  if (/матт|матов|matt/.test(text)) return 'матт';
  if (/силв|silv/.test(text)) return 'силвер';
  if (/голд|gold/.test(text)) return 'голд';
  if (/голог|софтач/.test(text)) return null;
  return 'глянец';
}

function widthOf(p: CatalogProduct): number | null {
  const fromSku = low(p.sku).match(/^(?:лам|lam)[^\d]*(\d+)/);
  if (fromSku) return Number(fromSku[1]);
  const fromName = low(p.name).match(/ф:\s*(\d+)|(\d+)\s*см/);
  return fromName ? Number(fromName[1] ?? fromName[2]) : null;
}

const isLamination = (p: CatalogProduct) => p.category === LAMINATION_CATEGORY || /^(лам|lam)/i.test(p.sku);

const toRef = ({ id, name, sku, unit }: CatalogProduct): ProductRef => ({ id, name, sku, unit });

/** По каким словам искать товары не из ламинации: на фото пишут по-разному. */
function keywordsOf(category: string): RegExp[] {
  const c = low(category).trim();
  if (/смыв/.test(c)) return [/смыв/];
  if (/фольг|фалг|foil/.test(c)) return [/фольг|фалг|foil/];
  if (/(уф|uv).*лак|лак.*(уф|uv)/.test(c)) return [/уф|uv/, /лак|uv-/];
  const words = c.split(/[^\p{L}\d]+/u).filter((w) => w.length >= 3);
  return words.map((w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

export function matchRow(row: RawRow, products: CatalogProduct[]): MatchedRow {
  const finish = finishOfRow(row.category);
  const width = row.format ? Number(String(row.format).replace(/[^\d]/g, '')) : NaN;

  let pool: CatalogProduct[];
  if (finish) {
    const lamination = products.filter(isLamination);
    pool = lamination.filter((p) => finishOfProduct(p) === finish && widthOf(p) === width);
    // Точного совпадения нет: дальше показываем плёнку той же отделки, чтобы выбрать вручную.
    if (pool.length === 0) {
      const sameFinish = lamination.filter((p) => finishOfProduct(p) === finish);
      return { ...row, product: null, candidates: sameFinish.slice(0, MAX_CANDIDATES).map(toRef) };
    }
  } else {
    const keywords = keywordsOf(row.category);
    pool = keywords.length
      ? products.filter((p) => keywords.every((k) => k.test(low(`${p.sku} ${p.name}`))))
      : [];
    if (Number.isFinite(width) && width > 0) {
      const number = new RegExp(`(^|\\D)${width}(\\D|$)`);
      const narrowed = pool.filter((p) => number.test(`${p.sku} ${p.name}`));
      if (narrowed.length > 0) pool = narrowed;
    }
  }

  if (pool.length === 1) return { ...row, product: toRef(pool[0]), candidates: [] };
  return { ...row, product: null, candidates: pool.slice(0, MAX_CANDIDATES).map(toRef) };
}

/** Сверка арифметики таблицы: ошибка распознавания почти всегда ломает суммы. */
export function checkArithmetic(rows: RawRow[], total: number | null): string[] {
  const warnings: string[] = [];
  let computed = 0;
  let complete = true;
  for (const row of rows) {
    const label = [row.category, row.format].filter(Boolean).join(' ');
    if (row.price == null) {
      complete = false;
      warnings.push(`${label}: не прочитана цена`);
      continue;
    }
    const lineSum = Math.round(row.qty * row.price);
    computed += lineSum;
    if (row.sum != null && Math.abs(lineSum - row.sum) > 1) {
      warnings.push(`${label}: ${row.qty} × ${row.price} = ${lineSum}, а в таблице ${row.sum}`);
    }
    if (row.uncertain) warnings.push(`${label}: строка читается плохо, проверьте по фото`);
  }
  if (complete && total != null && Math.abs(computed - total) > 1) {
    warnings.push(`Сумма строк ${computed}, а итог в таблице ${total}`);
  }
  return warnings;
}
