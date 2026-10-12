import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { TASHKENT_OFFSET_MS } from '../../lib/tz';
import { needsCallback } from '../mobile/mobile.mapping';
import { notServiceWhere } from '../mobile/mobile.service-phones';

/**
 * Отчёт по звонкам для HR и руководства: сколько звонил каждый сотрудник,
 * сколько разговоров состоялось, сколько времени в разговорах, пропущенные без
 * перезвона, в какие часы звонят. Только цифры — без записей и расшифровок.
 *
 * Источник — журнал CallSync (call_sessions). Служебные номера (склад, свои
 * сотрудники) не считаются: это не работа с клиентами. Удалённые руководителем
 * звонки (личные) тоже не считаются.
 */

const DAY_MS = 86400000;

export interface CallTotals {
  total: number;
  outbound: number;
  outboundConnected: number;
  inbound: number;
  inboundAnswered: number;
  /** Пропущенные/отклонённые входящие. */
  missed: number;
  /** Из них так и не перезвонили и клиент сам не дозвонился. */
  missedNotCalledBack: number;
  /** Разговоров состоялось (в обе стороны). */
  conversations: number;
  talkSec: number;
  uniqueNumbers: number;
}

export interface EmployeeCalls extends CallTotals {
  userId: string;
  fullName: string;
  role: string;
  avgTalkSec: number;
  /** Звонков с клиентами из CRM (номер привязан к клиенту). */
  clientCalls: number;
  /** Средняя минута первого звонка за день по Ташкенту (минут от полуночи) — когда человек начинает работать. */
  avgFirstCallMin: number | null;
  activeDays: number;
}

type Row = {
  managerUserId: string | null;
  direction: string;
  status: string;
  mobileType: string | null;
  startedAt: Date;
  durationSec: number | null;
  billSec: number | null;
  phoneKey: string | null;
  phone: string | null;
  clientId: string | null;
  calledBackAt: Date | null;
  followUpAt: Date | null;
};

function emptyTotals(): CallTotals {
  return {
    total: 0, outbound: 0, outboundConnected: 0, inbound: 0, inboundAnswered: 0,
    missed: 0, missedNotCalledBack: 0, conversations: 0, talkSec: 0, uniqueNumbers: 0,
  };
}

const connected = (r: Row) => r.status === 'COMPLETED' || r.status === 'ANSWERED';
const talk = (r: Row) => (connected(r) ? r.billSec ?? r.durationSec ?? 0 : 0);
/** Пропущенный входящий: у мобильных — missed/rejected, у АТС — статус MISSED. */
const isMissed = (r: Row) => (r.mobileType ? needsCallback(r.mobileType) : r.direction === 'INBOUND' && r.status === 'MISSED');

function addTo(t: CallTotals, r: Row) {
  t.total += 1;
  if (r.direction === 'OUTBOUND') {
    t.outbound += 1;
    if (connected(r)) t.outboundConnected += 1;
  } else {
    t.inbound += 1;
    if (connected(r)) t.inboundAnswered += 1;
  }
  if (isMissed(r)) {
    t.missed += 1;
    if (!r.calledBackAt && !r.followUpAt) t.missedNotCalledBack += 1;
  }
  if (connected(r)) t.conversations += 1;
  t.talkSec += talk(r);
}

const tkDay = (d: Date) => new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
const tkMinute = (d: Date) => {
  const t = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};

/** YYYY-MM-DD по Ташкенту → начало этого дня. */
export function tkDayStart(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new AppError(400, 'Некорректная дата (ожидается YYYY-MM-DD)');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - TASHKENT_OFFSET_MS);
}

async function loadRows(from: Date, to: Date, userId?: string): Promise<Row[]> {
  return prisma.callSession.findMany({
    where: {
      AND: [
        { deletedAt: null, managerUserId: userId ? userId : { not: null }, startedAt: { gte: from, lt: to } },
        { direction: { in: ['INBOUND', 'OUTBOUND'] } },
        await notServiceWhere(),
      ],
    },
    select: {
      managerUserId: true, direction: true, status: true, mobileType: true, startedAt: true,
      durationSec: true, billSec: true, phoneKey: true, phone: true, clientId: true,
      calledBackAt: true, followUpAt: true,
    },
  });
}

function totalsOf(rows: Row[]): CallTotals {
  const t = emptyTotals();
  const numbers = new Set<string>();
  for (const r of rows) {
    addTo(t, r);
    const n = r.phoneKey || r.phone;
    if (n) numbers.add(n);
  }
  t.uniqueNumbers = numbers.size;
  return t;
}

export async function getCallReport(opts: { from: Date; to: Date; userId?: string }) {
  if (opts.to <= opts.from) throw new AppError(400, 'Конец периода раньше начала');
  if (opts.to.getTime() - opts.from.getTime() > 186 * DAY_MS) throw new AppError(400, 'Период не больше полугода');

  // Прошлый период той же длины — для сравнения
  const len = opts.to.getTime() - opts.from.getTime();
  const prevFrom = new Date(opts.from.getTime() - len);

  const [rows, prevRows] = await Promise.all([
    loadRows(opts.from, opts.to, opts.userId),
    loadRows(prevFrom, opts.from, opts.userId),
  ]);

  const ids = [...new Set([...rows, ...prevRows].map((r) => r.managerUserId!).filter(Boolean))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: true } });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const byUser = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.managerUserId!;
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k)!.push(r);
  }
  const prevByUser = new Map<string, number>();
  for (const r of prevRows) prevByUser.set(r.managerUserId!, (prevByUser.get(r.managerUserId!) ?? 0) + 1);

  const employees: (EmployeeCalls & { prevTotal: number })[] = [...byUser.entries()].map(([id, list]) => {
    const t = totalsOf(list);
    // Первый звонок каждого дня → среднее время начала работы
    const firstByDay = new Map<string, number>();
    for (const r of list) {
      const d = tkDay(r.startedAt);
      const m = tkMinute(r.startedAt);
      if (!firstByDay.has(d) || m < firstByDay.get(d)!) firstByDay.set(d, m);
    }
    const firsts = [...firstByDay.values()];
    const u = userMap.get(id);
    return {
      ...t,
      userId: id,
      fullName: u?.fullName ?? 'Неизвестный сотрудник',
      role: u?.role ?? '',
      avgTalkSec: t.conversations ? Math.round(t.talkSec / t.conversations) : 0,
      clientCalls: list.filter((r) => r.clientId).length,
      avgFirstCallMin: firsts.length ? Math.round(firsts.reduce((s, v) => s + v, 0) / firsts.length) : null,
      activeDays: firstByDay.size,
      prevTotal: prevByUser.get(id) ?? 0,
    };
  });
  // В прошлом периоде звонил, в этом — ни разу: тоже показываем, с нулями
  for (const [id, n] of prevByUser) {
    if (byUser.has(id)) continue;
    const u = userMap.get(id);
    employees.push({
      ...emptyTotals(), userId: id, fullName: u?.fullName ?? 'Неизвестный сотрудник', role: u?.role ?? '',
      avgTalkSec: 0, clientCalls: 0, avgFirstCallMin: null, activeDays: 0, prevTotal: n,
    });
  }
  employees.sort((a, b) => b.total - a.total || b.talkSec - a.talkSec);

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, outbound: 0, inbound: 0 }));
  for (const r of rows) {
    const h = Math.floor(tkMinute(r.startedAt) / 60);
    if (r.direction === 'OUTBOUND') byHour[h].outbound += 1;
    else byHour[h].inbound += 1;
  }

  const days = new Map<string, { day: string; outbound: number; inbound: number; talkSec: number }>();
  for (let t = opts.from.getTime(); t < opts.to.getTime(); t += DAY_MS) {
    const d = tkDay(new Date(t));
    days.set(d, { day: d, outbound: 0, inbound: 0, talkSec: 0 });
  }
  for (const r of rows) {
    const d = days.get(tkDay(r.startedAt));
    if (!d) continue;
    if (r.direction === 'OUTBOUND') d.outbound += 1;
    else d.inbound += 1;
    d.talkSec += talk(r);
  }

  return {
    period: { from: opts.from, to: opts.to },
    totals: totalsOf(rows),
    prevTotals: totalsOf(prevRows),
    employees,
    byHour,
    byDay: [...days.values()],
  };
}
