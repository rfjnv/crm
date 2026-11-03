import prisma from '../../lib/prisma';
import { tashkentStartOfToday } from '../../lib/tz';
import { MISSED_WHERE, scopeFor, seesEveryone, tashkentDate, type CallsUser } from './calls.service';

interface Counters {
  /** Звонков всего */
  calls: number;
  /** Состоявшихся разговоров */
  conversations: number;
  incoming: number;
  outgoing: number;
  /** С разными номерами — «общалась с N людьми» */
  people: number;
  talkSec: number;
  /** Исходящие без ответа */
  notReached: number;
  /** Пропущенные входящие и сколько из них ещё не отработано */
  missed: number;
  missedPending: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

type Row = {
  managerUserId: string | null;
  phoneKey: string | null;
  direction: string;
  status: string;
  durationSec: number | null;
  startedAt: Date;
  calledBackAt: Date | null;
  followUpAt: Date | null;
  missed: boolean;
};

function count(rows: Row[]): Counters {
  const people = new Set<string>();
  const c: Counters = {
    calls: rows.length, conversations: 0, incoming: 0, outgoing: 0, people: 0, talkSec: 0,
    notReached: 0, missed: 0, missedPending: 0, firstAt: null, lastAt: null,
  };
  for (const r of rows) {
    if (!c.firstAt || r.startedAt < c.firstAt) c.firstAt = r.startedAt;
    if (!c.lastAt || r.startedAt > c.lastAt) c.lastAt = r.startedAt;
    if (r.status === 'COMPLETED' && (r.durationSec ?? 0) > 0) {
      c.conversations += 1;
      c.talkSec += r.durationSec ?? 0;
      if (r.direction === 'OUTBOUND') c.outgoing += 1;
      else c.incoming += 1;
      if (r.phoneKey) people.add(r.phoneKey);
    } else if (r.direction === 'OUTBOUND') {
      c.notReached += 1;
    } else if (r.missed) {
      c.missed += 1;
      if (!r.followUpAt && !r.calledBackAt) c.missedPending += 1;
    }
  }
  c.people = people.size;
  return c;
}

/**
 * Сводка «Звонков HR» за период (по умолчанию — сегодня по Ташкенту): со сколькими людьми
 * поговорила, сколько разговоров и минут, кому не дозвонилась, сколько пропущенных не отработано.
 * Тем, кто видит всех, — ещё и по сотрудникам.
 */
export async function hrSummary(user: CallsUser, q: { from?: string; to?: string }) {
  const startedAt = {
    gte: q.from ? tashkentDate(q.from) : tashkentStartOfToday(),
    ...(q.to ? { lt: tashkentDate(q.to, true) } : {}),
  };
  const where = { AND: [scopeFor(user, 'HR'), { startedAt }] };
  const [rows, missedIds] = await Promise.all([
    prisma.callSession.findMany({
      where,
      select: {
        id: true, managerUserId: true, phoneKey: true, direction: true, status: true, durationSec: true,
        startedAt: true, calledBackAt: true, followUpAt: true, manager: { select: { id: true, fullName: true } },
      },
    }),
    // «Пропущенный» — то же правило, что в журнале и виджете (без заблокированных и автоответчика)
    prisma.callSession.findMany({ where: { AND: [where, MISSED_WHERE] }, select: { id: true } }),
  ]);
  const missed = new Set(missedIds.map((m) => m.id));
  const list: Row[] = rows.map((r) => ({ ...r, missed: missed.has(r.id) }));

  const total = count(list);
  if (!seesEveryone(user, 'HR')) return { ...total, employees: null };

  const names = new Map<string, string>();
  const byEmployee = new Map<string, Row[]>();
  rows.forEach((r, i) => {
    if (!r.managerUserId) return;
    if (r.manager) names.set(r.managerUserId, r.manager.fullName);
    const arr = byEmployee.get(r.managerUserId) ?? [];
    arr.push(list[i]);
    byEmployee.set(r.managerUserId, arr);
  });
  const employees = [...byEmployee.entries()]
    .map(([id, rs]) => ({ id, fullName: names.get(id) ?? '—', ...count(rs) }))
    .sort((a, b) => b.conversations - a.conversations);
  return { ...total, employees };
}
