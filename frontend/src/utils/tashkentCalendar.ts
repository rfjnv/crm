/** Календарная дата в Ташкенте (YYYY-MM-DD). */
export function tashkentYmd(d = new Date()): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
}

export function isoRangeForTashkentYmd(ymd: string): { closedFrom: string; closedTo: string } {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00+05:00`).toISOString();
  const to = new Date(`${y}-${pad(m)}-${pad(d)}T23:59:59.999+05:00`).toISOString();
  return { closedFrom: from, closedTo: to };
}

export function addDaysToTashkentYmd(ymd: string, delta: number): string {
  const { closedFrom } = isoRangeForTashkentYmd(ymd);
  const ms = new Date(closedFrom).getTime() + delta * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
}
