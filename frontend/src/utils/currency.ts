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
