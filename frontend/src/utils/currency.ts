/** Trim trailing .0 from compact amounts */
function trimCompactDecimals(x: number): string {
  const s = x % 1 === 0 ? x.toFixed(0) : x.toFixed(1);
  return s.replace(/\.0$/, '');
}

/**
 * Short Russian labels for chart axes / tooltips (тыс. / млн / млрд).
 * Example: 250_000_000 → "250 млн"
 */
export function formatUzCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '−' : '';
  const v = Math.abs(Math.round(value));
  if (v >= 1_000_000_000) {
    return `${sign}${trimCompactDecimals(v / 1_000_000_000)} млрд`;
  }
  if (v >= 1_000_000) {
    return `${sign}${trimCompactDecimals(v / 1_000_000)} млн`;
  }
  if (v >= 1_000) {
    return `${sign}${trimCompactDecimals(v / 1_000)} тыс`;
  }
  return `${sign}${v}`;
}

export function formatUZS(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num)) return '0 so\u2019m';
  const rounded = Math.round(num);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so\u2019m';
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
