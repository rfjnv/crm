import prisma from '../../lib/prisma';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';

type NotifiedTask = { assigneeId: string; title: string; dueDate?: Date | null };

const MAX_TITLES = 5;

const KIND = {
  assigned: { one: 'Новая задача', many: 'Новые задачи' },
  due: { one: 'Изменён срок задачи', many: 'Изменён срок задач' },
} as const;

function dueText(d?: Date | null): string {
  if (!d) return ' — срок снят';
  return ` — до ${d.toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit' })}`;
}

/**
 * Сообщить исполнителям о задачах: колокольчик, push и Telegram.
 * По одному сообщению на человека, даже если задач несколько. Себе не шлём.
 * Ошибки не пробрасываем — задача уже сохранена, уведомление вторично.
 */
async function notifyAssignees(kind: keyof typeof KIND, tasks: NotifiedTask[], byUserId: string): Promise<void> {
  const byAssignee = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.assigneeId === byUserId) continue;
    const line = `• ${t.title.split('\n')[0]}${kind === 'due' ? dueText(t.dueDate) : ''}`;
    byAssignee.set(t.assigneeId, [...(byAssignee.get(t.assigneeId) ?? []), line]);
  }
  if (!byAssignee.size) return;

  try {
    const author = await prisma.user.findUnique({ where: { id: byUserId }, select: { fullName: true } });
    const from = author ? `От: ${author.fullName}\n` : '';

    const messages = [...byAssignee].map(([userId, lines]) => {
      const more = lines.length > MAX_TITLES ? `\n…и ещё ${lines.length - MAX_TITLES}` : '';
      return {
        userId,
        title: lines.length === 1 ? KIND[kind].one : `${KIND[kind].many}: ${lines.length}`,
        body: `${from}${lines.slice(0, MAX_TITLES).join('\n')}${more}`,
      };
    });

    await prisma.notification.createMany({
      data: messages.map((m) => ({
        userId: m.userId,
        title: m.title,
        body: m.body,
        severity: 'WARNING' as const,
        link: '/tasks',
        createdByUserId: byUserId,
      })),
    });

    for (const m of messages) {
      const payload = { title: m.title, body: m.body, url: '/tasks', severity: 'WARNING' as const };
      pushService.sendPushToUser(m.userId, payload).catch(() => {});
      telegramService.sendToUser(m.userId, payload).catch(() => {});
    }
  } catch (err) {
    console.error(`notifyAssignees(${kind}) failed:`, (err as Error).message);
  }
}

export function notifyTasksAssigned(tasks: NotifiedTask[], byUserId: string): Promise<void> {
  return notifyAssignees('assigned', tasks, byUserId);
}

export function notifyTasksDueChanged(tasks: NotifiedTask[], byUserId: string): Promise<void> {
  return notifyAssignees('due', tasks, byUserId);
}
