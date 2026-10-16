import { Prisma } from '@prisma/client';
import prisma from './prisma';

/** Последний состоявшийся звонок с клиентом: из телефонии (CallSync/Asterisk) или из «Заметки обзвонов». */
export interface LastClientCall {
  at: Date;
  source: 'phone' | 'board';
  authorName: string | null;
  /** Короткое описание для колонок «Последний контакт» */
  preview: string;
}

function formatDuration(sec: number | null): string {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * По каждому клиенту — последний звонок, где дозвонились. Звонки, удалённые руководителем
 * (личные), не учитываются. Пропущенные и недозвоны контактом не считаем.
 */
export async function lastCallByClient(clientIds: string[]): Promise<Map<string, LastClientCall>> {
  const result = new Map<string, LastClientCall>();
  if (clientIds.length === 0) return result;

  const [phoneRows, boardRows] = await Promise.all([
    prisma.$queryRaw<{ client_id: string; at: Date; direction: string; duration_sec: number | null; author_name: string | null }[]>(
      Prisma.sql`SELECT DISTINCT ON (cs.client_id)
          cs.client_id,
          cs.started_at AS at,
          cs.direction::text AS direction,
          COALESCE(cs.bill_sec, cs.duration_sec) AS duration_sec,
          u.full_name AS author_name
        FROM call_sessions cs
        LEFT JOIN users u ON u.id = cs.manager_user_id
        WHERE cs.deleted_at IS NULL
          AND cs.status IN ('ANSWERED', 'COMPLETED')
          AND cs.client_id IN (${Prisma.join(clientIds)})
        ORDER BY cs.client_id, cs.started_at DESC`,
    ),
    prisma.$queryRaw<{ client_id: string; at: Date; comment: string; author_name: string | null }[]>(
      Prisma.sql`SELECT DISTINCT ON (nb.client_id)
          nb.client_id,
          nb.last_call_at AS at,
          nb.comment,
          u.full_name AS author_name
        FROM notes_board_rows nb
        LEFT JOIN users u ON u.id = nb.author_id
        WHERE nb.call_result = 'ANSWERED'
          AND nb.client_id IN (${Prisma.join(clientIds)})
        ORDER BY nb.client_id, nb.last_call_at DESC`,
    ),
  ]);

  for (const r of phoneRows) {
    const kind = r.direction === 'OUTBOUND' ? 'Исходящий звонок' : 'Входящий звонок';
    result.set(r.client_id, {
      at: r.at,
      source: 'phone',
      authorName: r.author_name,
      preview: `${kind}, ${formatDuration(r.duration_sec)}`,
    });
  }
  for (const r of boardRows) {
    const prev = result.get(r.client_id);
    if (prev && prev.at >= r.at) continue;
    const comment = r.comment.trim();
    result.set(r.client_id, {
      at: r.at,
      source: 'board',
      authorName: r.author_name,
      preview: comment ? `Обзвон: ${comment}` : 'Обзвон',
    });
  }
  return result;
}
