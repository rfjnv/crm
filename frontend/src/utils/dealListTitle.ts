import type { Deal } from '../types';

/**
 * Убираем старый хвост « — DD.MM.YYYY» / « от DD.MM.YYYY» и подставляем одну дату из полей сделки (Ташкент).
 * Для CLOSED — календарная дата закрытия (как в колонке «Дата закрытия»), иначе — дата создания.
 */

export function stripDealTitleDateSuffix(title: string): string {
  let t = (title || '').trim();
  t = t.replace(/\s*—\s*\d{1,2}\.\d{1,2}\.\d{4}\s*$/u, '');
  t = t.replace(/\s+от\s+\d{1,2}\.\d{1,2}\.\d{4}\s*$/iu, '');
  return t.trim() || (title || '').trim();
}

export function dealListTitle(
  deal: Pick<Deal, 'title' | 'createdAt' | 'updatedAt' | 'status'> & { closedAt?: string | null },
): string {
  const base = stripDealTitleDateSuffix(deal.title);
  const iso =
    deal.status === 'CLOSED' ? (deal.closedAt ?? deal.updatedAt) : deal.createdAt;
  const d = new Date(iso);
  const ymd = d.toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' });
  return `${base} — ${ymd}`;
}
