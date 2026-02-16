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
