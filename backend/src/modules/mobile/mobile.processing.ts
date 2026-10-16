import { Prisma, type CallSession, type TaskStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { formatUzPhone } from '../../lib/phone';
import { telegramService } from '../telegram/telegram.service';
import { isServicePhone } from './mobile.service-phones';
import {
  CALLBACK_TYPES,
  clientPhoneKeys,
  formatTashkentTime,
  isConversation,
  needsCallback,
} from './mobile.mapping';

/**
 * Что сервер делает со звонком после того, как он записан: ищет клиента по номеру, отмечает,
 * кто перезвонил после пропущенного, пишет менеджеру в Telegram о пропущенном и закрывает
 * задачи «перезвонить» (их ставят только вручную), когда разговор с номером состоялся.
 * Приложению результат не нужен, поэтому ошибки здесь не роняют ответ на POST /api/calls.
 */

const HOUR_MS = 60 * 60 * 1000;
/**
 * Telegram — только по свежим пропущенным. При первом входе приложение присылает историю
 * за 7 дней: сообщений о неделе старых пропущенных никто не ждёт.
 */
const CALLBACK_MAX_AGE_MS = 24 * HOUR_MS;

export const OPEN_TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS'];

export type ClientMatch =
  | { client: { id: string; companyName: string; managerId: string }; ambiguous?: undefined }
  | { client: null; ambiguous?: string[] };

/**
 * Клиент по номеру. Номера сравниваем только через phoneMatchKey: в CRM они хранятся
 * как «+998 XX XXX XX XX», а в одном поле бывает несколько номеров. SQL лишь отсекает
 * заведомо неподходящих (цифры номера должны встречаться в поле), точное сравнение — в JS.
 * Несколько клиентов с таким номером — берём клиента этого же менеджера, иначе никого.
 */
export async function findClientByPhone(key: string, managerId: string | null): Promise<ClientMatch> {
  if (!key) return { client: null };
  const rows = await prisma.$queryRaw<{ id: string; phone: string; managerId: string; companyName: string }[]>(Prisma.sql`
    SELECT id, phone, manager_id AS "managerId", company_name AS "companyName"
    FROM clients
    WHERE is_archived = false AND phone IS NOT NULL
      AND regexp_replace(phone, '\\D', '', 'g') LIKE ${`%${key}%`}`);
  const matches = rows.filter((r) => clientPhoneKeys(r.phone).includes(key));
  if (matches.length === 1) return { client: matches[0] };
  if (matches.length > 1) {
    const own = matches.filter((m) => m.managerId === managerId);
    if (own.length === 1) return { client: own[0] };
    return { client: null, ambiguous: matches.map((m) => m.id) };
  }
  return { client: null };
}

/** Открытая задача «перезвонить» этому номеру у менеджера. */
export function findOpenCallbackTask(managerId: string, phoneKey: string) {
  return prisma.task.findFirst({
    where: { assigneeId: managerId, status: { in: OPEN_TASK_STATUSES }, callSession: { phoneKey } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, description: true, callSessionId: true },
  });
}

export function callbackTitle(label: string): string {
  return `Перезвонить: ${label}`;
}

export function phoneLabel(phone: string | null | undefined): string {
  return formatUzPhone(phone) ?? phone ?? 'скрытый номер';
}

/**
 * Менеджер перезвонил (или поговорил с клиентом, когда тот перезвонил сам): пропущенные с этого
 * номера до момента `at` отработаны, открытые задачи «перезвонить» — в DONE.
 */
export async function closeCallbacks(
  /** null — у всех менеджеров: с клиентом уже поговорили от компании, перезванивать никому не нужно */
  managerId: string | null,
  phoneKey: string,
  at: Date,
  report: string,
): Promise<{ calls: number; tasks: number }> {
  const calls = await prisma.callSession.updateMany({
    where: {
      ...(managerId ? { managerUserId: managerId } : {}),
      phoneKey,
      mobileType: { in: CALLBACK_TYPES },
      calledBackAt: null,
      startedAt: { lte: at },
    },
    data: { calledBackAt: at },
  });
  const tasks = await prisma.task.updateMany({
    where: {
      ...(managerId ? { assigneeId: managerId } : {}),
      status: { in: OPEN_TASK_STATUSES },
      callSession: { phoneKey, startedAt: { lte: at } },
    },
    data: { status: 'DONE', report },
  });
  return { calls: calls.count, tasks: tasks.count };
}

function appendRawEvent(session: Pick<CallSession, 'rawEvents'>, event: Record<string, unknown>): Prisma.InputJsonValue {
  const prev = Array.isArray(session.rawEvents) ? (session.rawEvents as Prisma.InputJsonValue[]) : [];
  return [...prev, { at: new Date().toISOString(), ...event }];
}

async function handleMissed(session: CallSession, managerId: string, phoneKey: string, clientName: string | null, now: Date) {
  // Пачка может прийти не по порядку: если разговор с этим номером (у любого менеджера) уже был позже — перезвонили
  const later = await prisma.callSession.findFirst({
    where: {
      phoneKey,
      deletedAt: null,
      startedAt: { gt: session.startedAt },
      mobileType: { in: ['in', 'out'] },
      durationSec: { gt: 0 },
    },
    orderBy: { startedAt: 'asc' },
    select: { startedAt: true },
  });
  if (later) {
    await prisma.callSession.update({ where: { id: session.id }, data: { calledBackAt: later.startedAt } });
    return;
  }
  if (now.getTime() - session.startedAt.getTime() > CALLBACK_MAX_AGE_MS) return;

  // Задачу не ставим: страница «Задачи» засорялась. Пропущенные видны в журнале («Не перезвонили»)
  // и в виджете «Пропущенные сегодня»; менеджеру — сообщение в Telegram.
  const label = clientName ?? phoneLabel(session.phone);
  await telegramService.sendToUser(managerId, {
    title: 'Пропущенный звонок',
    body: `${label} — ${formatTashkentTime(session.startedAt, now)}.
Перезвоните в течение 2 часов.`,
    url: `/calls?call=${session.id}`,
    severity: 'WARNING',
  });
}

/** Несостоявшийся звонок: пропущенный, отклонённый, исходящий без ответа. */
export const FAILED_CALL_STATUSES = ['MISSED', 'FAILED'] as const;

/**
 * Чем закончился несостоявшийся звонок: первый разговор с этим номером после него — любым
 * менеджером компании. Разговор с нашей стороны (OUTBOUND) — «перезвонил менеджер», входящий
 * (INBOUND) — «клиент перезвонил сам». Работает в обе стороны: пачка с телефона может прийти
 * не по порядку, и разговор окажется записан раньше пропущенного.
 */
/**
 * Разговор, который уже шёл в момент неудачного звонка (или закончился совсем недавно), тоже
 * его итог: клиент дважды не дозвонился до Дилнозы, позвонил Фарходу, и пока они говорили,
 * Дилноза перезвонила — клиент не взял, потому что был на линии. Такой недозвон не «не перезвонили».
 * Запас — и на расхождение часов на разных телефонах.
 */
export const BUSY_GRACE_MS = 5 * 60 * 1000;

function conversationEnd(c: Pick<CallSession, 'startedAt' | 'endedAt' | 'durationSec'>): Date {
  return c.endedAt ?? new Date(c.startedAt.getTime() + (c.durationSec ?? 0) * 1000);
}

export async function linkFollowUps(
  session: Pick<CallSession, 'id' | 'phoneKey' | 'status' | 'startedAt' | 'direction' | 'endedAt' | 'durationSec'>,
): Promise<void> {
  if (!session.phoneKey) return;
  if (session.status === 'COMPLETED') {
    const link = { followUpCallId: session.id, followUpAt: session.startedAt, followUpDirection: session.direction };
    // Несостоявшиеся звонки до разговора — и те, что пришлись на сам разговор (клиент был занят)
    await prisma.callSession.updateMany({
      where: {
        phoneKey: session.phoneKey,
        status: { in: [...FAILED_CALL_STATUSES] },
        startedAt: { lte: new Date(conversationEnd(session).getTime() + BUSY_GRACE_MS) },
        id: { not: session.id },
        deletedAt: null,
        OR: [{ followUpAt: null }, { followUpAt: { gt: session.startedAt } }],
      },
      data: link,
    });
    return;
  }
  if ((FAILED_CALL_STATUSES as readonly string[]).includes(session.status)) {
    // Клиент в этот момент уже разговаривал с кем-то из наших
    const busy = await prisma.callSession.findFirst({
      where: {
        phoneKey: session.phoneKey,
        status: 'COMPLETED',
        startedAt: { lte: session.startedAt },
        endedAt: { gte: new Date(session.startedAt.getTime() - BUSY_GRACE_MS) },
        deletedAt: null,
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, startedAt: true, direction: true },
    });
    const next = busy ?? await prisma.callSession.findFirst({
      where: { phoneKey: session.phoneKey, status: 'COMPLETED', startedAt: { gt: session.startedAt }, deletedAt: null },
      orderBy: { startedAt: 'asc' },
      select: { id: true, startedAt: true, direction: true },
    });
    if (next) {
      await prisma.callSession.update({
        where: { id: session.id },
        data: { followUpCallId: next.id, followUpAt: next.startedAt, followUpDirection: next.direction },
      });
    }
  }
}

/** Вызывается для каждого нового мобильного звонка, в порядке времени звонков. */
export async function processNewMobileCall(session: CallSession, now: Date = new Date()): Promise<void> {
  const managerId = session.managerUserId;
  const phoneKey = session.phoneKey ?? '';

  await linkFollowUps(session);

  // Служебный номер (склад, сотрудник): не клиент, задач «перезвонить» по нему не ставим
  if (await isServicePhone(phoneKey)) {
    if (managerId && isConversation(session.mobileType, session.durationSec)) {
      await closeCallbacks(null, phoneKey, session.startedAt, 'Закрыто автоматически: состоялся разговор с этим номером');
    }
    return;
  }

  // 1. Клиент по номеру. Неизвестный номер клиентом автоматически не становится:
  //    мусорные клиенты из каждого звонка испортят аналитику. Это просто звонок без clientId.
  let clientName: string | null = null;
  if (phoneKey && !session.clientId) {
    const match = await findClientByPhone(phoneKey, managerId);
    if (match.client) {
      clientName = match.client.companyName;
      await prisma.callSession.update({ where: { id: session.id }, data: { clientId: match.client.id } });
    } else if (match.ambiguous) {
      await prisma.callSession.update({
        where: { id: session.id },
        data: {
          rawEvents: appendRawEvent(session, {
            event: 'client_match',
            result: 'ambiguous',
            reason: 'Номер есть у нескольких клиентов, ни один не закреплён за этим менеджером',
            clientIds: match.ambiguous,
          }),
        },
      });
    }
  }

  if (!managerId || !phoneKey) return;

  // 2. Пропущенный — задача «перезвонить» и Telegram менеджеру
  if (needsCallback(session.mobileType)) {
    await handleMissed(session, managerId, phoneKey, clientName, now);
    return;
  }

  // 3. Состоялся разговор с этим номером — закрываем «перезвонить»
  if (isConversation(session.mobileType, session.durationSec)) {
    await closeCallbacks(null, phoneKey, session.startedAt, 'Закрыто автоматически: состоялся разговор с этим номером');
  }
}
