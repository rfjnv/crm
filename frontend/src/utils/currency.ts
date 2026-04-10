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

export function formatUZS(value: number | string): string {
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
