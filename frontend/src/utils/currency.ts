import { useAuthStore } from '../store/authStore';
import type { MoneyAccess } from '../types';

/**
 * Full-value Uzbek soum display (spaced thousands + so'm).
 * Independent from `formatShortNumber` — used for tooltips, tables, summaries.
 */
export function formatFullNumber(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num)) return '0 so\u2019m';
  const rounded = Math.round(num);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so\u2019m';
}

/**
 * Compact axis labels for narrow mobile only (тыс. / млн / млрд).
 * Independent from `formatFullNumber` — do not use for tooltips.
 */
export function formatShortNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '−' : '';
  const v = Math.abs(Math.round(value));
  let n: number;
  let suffix: string;
  if (v >= 1_000_000_000) {
    n = v / 1_000_000_000;
    suffix = ' млрд';
  } else if (v >= 1_000_000) {
    n = v / 1_000_000;
    suffix = ' млн';
  } else if (v >= 1_000) {
    n = v / 1_000;
    suffix = ' тыс.';
  } else {
    return `${sign}${v}`;
  }
  const raw = n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
  const trimmed = raw.replace(/\.0$/, '');
  return `${sign}${trimmed}${suffix}`;
}

/** Что видит сотрудник вместо скрытой суммы. */
export const HIDDEN_MONEY = '•••';

/** Уровень доступа текущего пользователя к деньгам (User.moneyAccess). */
export function moneyAccess(): MoneyAccess {
  return useAuthStore.getState().user?.moneyAccess ?? 'FULL';
}

/** Стратегическое скрыто: закупки, выручка, касса, KPI. Уровни NO_STRATEGIC и NONE. */
export function isStrategicHidden(): boolean {
  return moneyAccess() !== 'FULL';
}

/** Скрыты любые суммы. Уровень NONE. */
export function isMoneyHidden(): boolean {
  return moneyAccess() === 'NONE';
}

/**
 * Денежная сумма: итог сделки, выручка, долг, платёж — всё, что складывается из цен.
 * На уровне NONE маскируется. `null` — поле уже вырезал сервер: тоже маска.
 * Для цен за единицу используй `formatPrice`.
 */
export function formatUZS(value: number | string | null | undefined): string {
  if (value == null || isMoneyHidden()) return HIDDEN_MONEY;
  return formatFullNumber(value);
}

/**
 * Цена за единицу — видна на любом уровне: без неё не составить сделку.
 * `null` здесь означает, что сервер скрыл поле (напр. закупочную цену) — маска.
 */
export function formatPrice(value: number | string | null | undefined): string {
  if (value == null) return HIDDEN_MONEY;
  return formatFullNumber(value);
}

/** Целое число с разделителем тысяч: «13 572». Пустое и нечисловое — «0». */
export function formatCount(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '0';
  return Math.round(num).toLocaleString('ru-RU');
}

/** Компактная сумма для крупных чисел нового дизайна (DASHBOARD.md §4). */
export interface CompactMoney {
  /** Число без единицы: «1,9», «681», «12,4», «48 250». */
  text: string;
  /** Единица отдельным спаном рядом с числом; `null` — сумма показана полностью. */
  unit: 'млн' | 'млрд' | null;
  /** Полная сумма для `title` и тултипов: «1 897 406 478 so'm». */
  full: string;
  /** Сумма скрыта уровнем доступа или сервером — показывать как есть, без единицы. */
  hidden: boolean;
}

const COMPACT_HIDDEN: CompactMoney = { text: HIDDEN_MONEY, unit: null, full: HIDDEN_MONEY, hidden: true };

/**
 * Сумма компактно: от 1 млрд — «1,9 млрд», от 100 млн — «681 млн», от 1 млн — «12,4 млн»,
 * меньше — полностью с пробелами. Десятичный разделитель — запятая. Уважает скрытие сумм:
 * `null`/`undefined` (поле вырезал сервер) и уровень NONE дают маску, как `formatUZS`.
 */
export function formatMoneyCompact(value: number | string | null | undefined): CompactMoney {
  if (value == null || isMoneyHidden()) return COMPACT_HIDDEN;
  const raw = typeof value === 'string' ? Number(value) : value;
  const num = Number.isFinite(raw) ? raw : 0;
  const sign = num < 0 ? '−' : '';
  const abs = Math.abs(num);
  const full = formatFullNumber(num);
  const oneDecimal = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  // 999,96 млн при округлении до целых дал бы «1000 млн» — такие суммы уже «1 млрд»
  if (abs >= 999_950_000) return { text: sign + oneDecimal(abs / 1_000_000_000), unit: 'млрд', full, hidden: false };
  if (abs >= 100_000_000) return { text: sign + Math.round(abs / 1_000_000).toString(), unit: 'млн', full, hidden: false };
  if (abs >= 999_950) return { text: sign + oneDecimal(abs / 1_000_000), unit: 'млн', full, hidden: false };
  return { text: sign + moneyFormatter(abs), unit: null, full, hidden: false };
}

/**
 * Процент с запятой: в барах — целое («27 %»), в дельтах — одна десятая («+12,5 %», `signed`).
 * Пустое и нечисловое — «—».
 */
export function formatPercent(
  value: number | null | undefined,
  digits: 0 | 1,
  { signed = false }: { signed?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const text = Math.abs(value).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const isZero = Number(Math.abs(value).toFixed(digits)) === 0;
  const sign = value < 0 && !isZero ? '−' : signed && !isZero ? '+' : '';
  return `${sign}${text}\u00a0%`;
}

/** Formatter for Ant Design InputNumber — displays spaces between thousands */
export function moneyFormatter(value: number | string | undefined): string {
  if (value === undefined || value === '') return '';
  const rounded = Math.round(Number(value));
  if (isNaN(rounded)) return '';
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Parser for Ant Design InputNumber — strips spaces before saving */
export function moneyParser(value: string | undefined): string {
  return value ? value.replace(/\s/g, '') : '';
}
