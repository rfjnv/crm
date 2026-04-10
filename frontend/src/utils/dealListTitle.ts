/**
 * В списках показываем дату создания сделки (Ташкент), а не произвольную дату в хвосте названия.
 */

export function stripDealTitleDateSuffix(title: string): string {
  let t = (title || '').trim();
  t = t.replace(/\s*—\s*\d{1,2}\.\d{1,2}\.\d{4}\s*$/u, '');
  t = t.replace(/\s+от\s+\d{1,2}\.\d{1,2}\.\d{4}\s*$/iu, '');
  return t.trim() || (title || '').trim();
}

export function dealListTitle(deal: { title: string; createdAt: string }): string {
  const base = stripDealTitleDateSuffix(deal.title);
  const d = new Date(deal.createdAt);
  const ymd = d.toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' });
  return `${base} — ${ymd}`;
}
