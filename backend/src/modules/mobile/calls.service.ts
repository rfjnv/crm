import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { canonicalClientPhone } from '../../lib/phone';
import { tashkentStartOfToday, TASHKENT_OFFSET_MS } from '../../lib/tz';
import type { ListCallsQuery } from './mobile.dto';
import { canSeeAllCalls, callScope } from './mobile.access';
import { CALLBACK_TYPES, MOBILE_CALL_TYPES, clientPhoneKeys } from './mobile.mapping';
import { callbackTitle, closeCallbacks, findOpenCallbackTask, OPEN_TASK_STATUSES, phoneLabel } from './mobile.processing';
import { signedUrl } from './mobile.storage';

interface CallsUser {
  userId: string;
  role: string;
  permissions?: string[];
}

const HOUR_MS = 60 * 60 * 1000;

const callListSelect = {
  id: true,
  provider: true,
  direction: true,
  status: true,
  mobileType: true,
  startedAt: true,
  durationSec: true,
  phone: true,
  fromNumber: true,
  toNumber: true,
  simSlot: true,
  recordingPath: true,
  audioStatus: true,
  audioError: true,
  auditId: true,
  calledBackAt: true,
  manager: { select: { id: true, fullName: true } },
  client: { select: { id: true, companyName: true, contactName: true } },
} satisfies Prisma.CallSessionSelect;

type CallListRow = Prisma.CallSessionGetPayload<{ select: typeof callListSelect }>;

/** Номер собеседника: у мобильных — phone, у Asterisk — from/to в зависимости от направления. */
function counterpart(row: Pick<CallListRow, 'phone' | 'direction' | 'fromNumber' | 'toNumber'>): string | null {
  return row.phone ?? (row.direction === 'OUTBOUND' ? row.toNumber : row.fromNumber);
}

async function auditScores(auditIds: (string | null)[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(auditIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.callAudit.findMany({ where: { id: { in: ids } }, select: { id: true, score: true } });
  return new Map(rows.map((r) => [r.id, r.score]));
}

function toListItem(row: CallListRow, scores: Map<string, number | null>) {
  const { recordingPath, ...rest } = row;
  return {
    ...rest,
    counterpart: counterpart(row),
    hasRecording: !!recordingPath,
    auditScore: row.auditId ? scores.get(row.auditId) ?? null : null,
  };
}

/** Начало суток по Ташкенту для 'YYYY-MM-DD' (или сам момент, если пришло ISO-время). */
function tashkentDate(value: string, endOfDay = false): Date {
  if (value.length > 10) return new Date(value);
  const [y, m, d] = value.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) - TASHKENT_OFFSET_MS;
  return new Date(endOfDay ? start + 24 * HOUR_MS : start);
}

const MISSED_WHERE: Prisma.CallSessionWhereInput = {
  direction: 'INBOUND',
  status: 'MISSED',
  // Asterisk direction не уточняет; у мобильных blocked и voicemail не считаем пропущенными
  OR: [{ mobileType: null }, { mobileType: { in: CALLBACK_TYPES } }],
};

export async function listCalls(user: CallsUser, q: ListCallsQuery) {
  const and: Prisma.CallSessionWhereInput[] = [callScope(user)];
  if (q.from || q.to) {
    and.push({
      startedAt: {
        ...(q.from ? { gte: tashkentDate(q.from) } : {}),
        ...(q.to ? { lt: tashkentDate(q.to, true) } : {}),
      },
    });
  }
  if (q.managerId && canSeeAllCalls(user)) and.push({ managerUserId: q.managerId });
  if (q.type) {
    const types = q.type.split(',').map((t) => t.trim()).filter((t) => (MOBILE_CALL_TYPES as readonly string[]).includes(t));
    if (types.length > 0) and.push({ mobileType: { in: types } });
  }
  if (q.missedOnly) and.push(MISSED_WHERE);
  if (q.withRecording) and.push({ recordingPath: { not: null } });
  if (q.unknownOnly) and.push({ clientId: null });
  if (q.clientId) and.push({ clientId: q.clientId });
  const digits = q.phone?.replace(/\D/g, '');
  if (digits) and.push({ phone: { contains: digits } });

  const where: Prisma.CallSessionWhereInput = { AND: and };
  const [rows, totalCount] = await Promise.all([
    prisma.callSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: callListSelect,
    }),
    prisma.callSession.count({ where }),
  ]);
  const scores = await auditScores(rows.map((r) => r.auditId));
  return { items: rows.map((r) => toListItem(r, scores)), totalCount, page: q.page, pageSize: q.pageSize };
}

/** Звонок с проверкой доступа. Чужой звонок для менеджера — 404, как будто его нет. */
export async function findCallForUser<S extends Prisma.CallSessionSelect>(user: CallsUser, id: string, select: S) {
  const row = await prisma.callSession.findFirst({ where: { AND: [{ id }, callScope(user)] }, select });
  if (!row) throw new AppError(404, 'Звонок не найден');
  return row;
}

export async function getCall(user: CallsUser, id: string) {
  const row = await findCallForUser(user, id, {
    ...callListSelect,
    transcript: true,
    endedAt: true,
    deviceId: true,
    rawEvents: true,
    tasks: { select: { id: true, title: true, status: true, dueDate: true }, orderBy: { createdAt: 'desc' } },
  });
  const scores = await auditScores([row.auditId]);
  // Итог аудита — прямо в карточке звонка: кто видит звонок, тот видит и разбор
  const audit = row.auditId
    ? await prisma.callAudit.findUnique({
      where: { id: row.auditId },
      select: { id: true, score: true, saleProbability: true, analysis: true, mentorTips: true, stageChecklist: true },
    })
    : null;
  const { rawEvents, ...rest } = row;
  // Из журнала событий наружу — только заметка о неоднозначном клиенте
  const clientMatchNote = Array.isArray(rawEvents)
    ? (rawEvents as { event?: string; reason?: string }[]).filter((e) => e?.event === 'client_match').map((e) => e.reason).pop() ?? null
    : null;
  return { ...toListItem(rest, scores), transcript: row.transcript, endedAt: row.endedAt, tasks: row.tasks, clientMatchNote, audit };
}

export async function getAudioUrl(user: CallsUser, id: string) {
  const row = await findCallForUser(user, id, { recordingPath: true });
  if (!row.recordingPath) throw new AppError(404, 'У звонка нет записи');
  return { url: await signedUrl(row.recordingPath, 3600), expiresInSec: 3600 };
}

/**
 * Привязать номер к клиенту. Заодно к клиенту уходят все звонки с этим номером, у которых
 * клиента ещё нет. Если у клиента пустой телефон — по флагу savePhone записываем номер.
 */
export async function linkClient(user: CallsUser, id: string, clientId: string, savePhone?: boolean) {
  const call = await findCallForUser(user, id, { id: true, phone: true, phoneKey: true });
  const client = await prisma.client.findFirst({ where: { id: clientId, isArchived: false }, select: { id: true, phone: true } });
  if (!client) throw new AppError(404, 'Клиент не найден');

  const affected = await prisma.callSession.findMany({
    where: call.phoneKey ? { OR: [{ id: call.id }, { phoneKey: call.phoneKey, clientId: null }] } : { id: call.id },
    select: { id: true, auditId: true },
  });
  await prisma.callSession.updateMany({ where: { id: { in: affected.map((a) => a.id) } }, data: { clientId: client.id } });
  const auditIds = affected.map((a) => a.auditId).filter((v): v is string => !!v);
  if (auditIds.length > 0) {
    await prisma.callAudit.updateMany({ where: { id: { in: auditIds }, clientId: null }, data: { clientId: client.id } });
  }

  const clientPhoneEmpty = !client.phone?.trim();
  const phoneToSave = canonicalClientPhone(call.phone);
  let phoneSaved = false;
  if (savePhone && clientPhoneEmpty && phoneToSave) {
    await prisma.client.update({ where: { id: client.id }, data: { phone: phoneToSave } });
    phoneSaved = true;
  }
  return {
    linkedCount: affected.length,
    phoneSaved,
    /** У клиента нет телефона — интерфейс предлагает записать этот номер */
    suggestSavePhone: clientPhoneEmpty && !phoneSaved && !!phoneToSave,
    phone: phoneToSave,
  };
}

export async function createCallbackTask(user: CallsUser, id: string, opts: { dueAt?: string; note?: string } = {}) {
  const call = await findCallForUser(user, id, {
    id: true,
    phone: true,
    phoneKey: true,
    managerUserId: true,
    client: { select: { companyName: true } },
  });
  const assigneeId = call.managerUserId ?? user.userId;
  if (call.phoneKey) {
    const open = await findOpenCallbackTask(assigneeId, call.phoneKey);
    if (open) return { taskId: open.id, existing: true };
  }
  const task = await prisma.task.create({
    data: {
      title: callbackTitle(call.client?.companyName ?? phoneLabel(call.phone)),
      description: opts.note || `Перезвонить на ${phoneLabel(call.phone)}.`,
      assigneeId,
      createdById: user.userId,
      dueDate: opts.dueAt ? new Date(opts.dueAt) : new Date(Date.now() + 2 * HOUR_MS),
      callSessionId: call.id,
    },
    select: { id: true },
  });
  return { taskId: task.id, existing: false };
}

/** Кнопка «Перезвонил»: пропущенные с этого номера отработаны, задачи «перезвонить» закрыты. */
export async function markCalledBack(user: CallsUser, id: string) {
  const call = await findCallForUser(user, id, { id: true, phoneKey: true, managerUserId: true });
  const now = new Date();
  if (call.managerUserId && call.phoneKey) {
    return closeCallbacks(call.managerUserId, call.phoneKey, now, 'Перезвонил');
  }
  await prisma.callSession.update({ where: { id: call.id }, data: { calledBackAt: now } });
  const tasks = await prisma.task.updateMany({
    where: { callSessionId: call.id, status: { in: OPEN_TASK_STATUSES } },
    data: { status: 'DONE', report: 'Перезвонил' },
  });
  return { calls: 1, tasks: tasks.count };
}

// ─── Пропущенные сегодня ────────────────────────────────────────────────────

/** Не отработан дольше этого — подсветка у руководителя */
const OVERDUE_MS = 2 * HOUR_MS;

export async function missedToday(user: CallsUser, now: Date = new Date()) {
  const leader = canSeeAllCalls(user);
  const rows = await prisma.callSession.findMany({
    where: { AND: [callScope(user), MISSED_WHERE, { startedAt: { gte: tashkentStartOfToday() } }] },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      startedAt: true,
      phone: true,
      phoneKey: true,
      fromNumber: true,
      calledBackAt: true,
      managerUserId: true,
      manager: { select: { id: true, fullName: true } },
      client: { select: { id: true, companyName: true } },
    },
  });

  // Один номер звонил несколько раз — одна строка
  const groups = new Map<string, {
    callId: string; managerId: string | null; managerName: string | null; phone: string | null;
    client: { id: string; companyName: string } | null; missedCount: number; lastAt: Date; firstAt: Date;
    handled: boolean; overdue: boolean;
  }>();
  for (const r of rows) {
    const key = `${r.managerUserId ?? ''}:${r.phoneKey || r.id}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        callId: r.id,
        managerId: r.managerUserId,
        managerName: r.manager?.fullName ?? null,
        phone: r.phone ?? r.fromNumber,
        client: r.client,
        missedCount: 1,
        lastAt: r.startedAt,
        firstAt: r.startedAt,
        handled: !!r.calledBackAt,
        overdue: false,
      });
    } else {
      g.missedCount += 1;
      g.firstAt = r.startedAt;
      g.handled = g.handled && !!r.calledBackAt;
      g.client = g.client ?? r.client;
    }
  }
  const items = [...groups.values()].map((g) => ({
    ...g,
    overdue: !g.handled && now.getTime() - g.firstAt.getTime() > OVERDUE_MS,
  }));
  items.sort((a, b) => Number(a.handled) - Number(b.handled) || b.lastAt.getTime() - a.lastAt.getTime());

  if (!leader) {
    return { scope: 'own' as const, items, pendingCount: items.filter((i) => !i.handled).length };
  }

  const byManager = new Map<string, { managerId: string; managerName: string; missedCount: number; pendingCount: number; overdueCount: number; oldestPendingAt: Date | null }>();
  for (const i of items) {
    if (!i.managerId) continue;
    const m = byManager.get(i.managerId) ?? {
      managerId: i.managerId, managerName: i.managerName ?? '—', missedCount: 0, pendingCount: 0, overdueCount: 0, oldestPendingAt: null,
    };
    m.missedCount += i.missedCount;
    if (!i.handled) {
      m.pendingCount += 1;
      if (!m.oldestPendingAt || i.firstAt < m.oldestPendingAt) m.oldestPendingAt = i.firstAt;
    }
    if (i.overdue) m.overdueCount += 1;
    byManager.set(i.managerId, m);
  }
  const managers = [...byManager.values()].sort((a, b) => b.overdueCount - a.overdueCount || b.pendingCount - a.pendingCount);
  return { scope: 'all' as const, items, managers, pendingCount: items.filter((i) => !i.handled).length };
}

// ─── Звонки клиента ─────────────────────────────────────────────────────────

const STATS_DAYS = 30;

export async function clientCalls(user: CallsUser, clientId: string, page = 1, pageSize = 30) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, phone: true } });
  if (!client) throw new AppError(404, 'Клиент не найден');
  const keys = clientPhoneKeys(client.phone);
  // Звонки, привязанные к клиенту, и звонки с его номеров, где клиент не определён
  // (номер есть у нескольких клиентов)
  const byClient: Prisma.CallSessionWhereInput = {
    OR: [{ clientId }, ...(keys.length > 0 ? [{ clientId: null, phoneKey: { in: keys } }] : [])],
  };
  const where: Prisma.CallSessionWhereInput = { AND: [callScope(user), byClient] };
  const since = new Date(Date.now() - STATS_DAYS * 24 * HOUR_MS);
  const statsWhere: Prisma.CallSessionWhereInput = { AND: [where, { startedAt: { gte: since } }] };

  const [rows, totalCount, callsCount, missedCount, avg] = await Promise.all([
    prisma.callSession.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: callListSelect }),
    prisma.callSession.count({ where }),
    prisma.callSession.count({ where: statsWhere }),
    prisma.callSession.count({ where: { AND: [statsWhere, MISSED_WHERE] } }),
    prisma.callSession.aggregate({
      where: { AND: [statsWhere, { status: 'COMPLETED', durationSec: { gt: 0 } }] },
      _avg: { durationSec: true },
    }),
  ]);
  const scores = await auditScores(rows.map((r) => r.auditId));
  return {
    items: rows.map((r) => toListItem(r, scores)),
    totalCount,
    page,
    pageSize,
    stats: {
      days: STATS_DAYS,
      callsCount,
      missedCount,
      avgDurationSec: avg._avg.durationSec != null ? Math.round(avg._avg.durationSec) : null,
    },
  };
}
