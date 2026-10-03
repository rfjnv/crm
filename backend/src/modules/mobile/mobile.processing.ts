import { Prisma, type CallSession, type TaskStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { formatUzPhone } from '../../lib/phone';
import { telegramService } from '../telegram/telegram.service';
import {
  CALLBACK_TYPES,
  clientPhoneKeys,
  formatTashkentTime,
  isConversation,
  needsCallback,
} from './mobile.mapping';

/**
 * Что сервер делает со звонком после того, как он записан: ищет клиента по номеру,
 * ставит задачу «перезвонить» по пропущенному и закрывает её, когда разговор состоялся.
 * Приложению результат не нужен, поэтому ошибки здесь не роняют ответ на POST /api/calls.
 */

const HOUR_MS = 60 * 60 * 1000;
/** Срок задачи «перезвонить» */
const CALLBACK_DUE_MS = 2 * HOUR_MS;
/**
 * Задачи и Telegram — только по свежим пропущенным. При первом входе приложение присылает
 * историю за 7 дней: неделю старых пропущенных в виде задач и сообщений никто не ждёт.
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
  managerId: string,
  phoneKey: string,
  at: Date,
  report: string,
): Promise<{ calls: number; tasks: number }> {
  const calls = await prisma.callSession.updateMany({
    where: {
      managerUserId: managerId,
      phoneKey,
      mobileType: { in: CALLBACK_TYPES },
      calledBackAt: null,
      startedAt: { lte: at },
    },
    data: { calledBackAt: at },
  });
  const tasks = await prisma.task.updateMany({
    where: {
      assigneeId: managerId,
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
  // Пачка может прийти не по порядку: если разговор с этим номером уже был позже — перезвонили
  const later = await prisma.callSession.findFirst({
    where: {
      managerUserId: managerId,
      phoneKey,
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

  const label = clientName ?? phoneLabel(session.phone);
  const time = formatTashkentTime(session.startedAt, now);
  const open = await findOpenCallbackTask(managerId, phoneKey);
  if (open) {
    await prisma.task.update({
      where: { id: open.id },
      data: { description: `${open.description ?? ''}\nЕщё пропущенный: ${time}`.trim() },
    });
  } else {
    const due = new Date(Math.max(session.startedAt.getTime(), now.getTime() - CALLBACK_DUE_MS) + CALLBACK_DUE_MS);
    await prisma.task.create({
      data: {
        title: callbackTitle(label),
        description: `Пропущенный звонок ${time} с номера ${phoneLabel(session.phone)}.`,
        assigneeId: managerId,
        createdById: managerId,
        dueDate: due,
        callSessionId: session.id,
      },
    });
  }

  await telegramService.sendToUser(managerId, {
    title: open ? 'Снова пропущенный звонок' : 'Пропущенный звонок',
    body: `${label} — ${time}.\nПерезвоните в течение 2 часов.`,
    url: `/calls?call=${session.id}`,
    severity: 'WARNING',
  });
}

/** Вызывается для каждого нового мобильного звонка, в порядке времени звонков. */
export async function processNewMobileCall(session: CallSession, now: Date = new Date()): Promise<void> {
  const managerId = session.managerUserId;
  const phoneKey = session.phoneKey ?? '';

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
    await closeCallbacks(managerId, phoneKey, session.startedAt, 'Закрыто автоматически: состоялся разговор с этим номером');
  }
}
