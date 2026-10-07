import prisma from '../../lib/prisma';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';

type AssignedTask = { assigneeId: string; title: string };

const MAX_TITLES = 5;

/**
 * Сообщить исполнителям о новых задачах: колокольчик, push и Telegram.
 * По одному сообщению на человека, даже если задач несколько. Себе не шлём.
 * Ошибки не пробрасываем — задача уже создана, уведомление вторично.
 */
export async function notifyTasksAssigned(tasks: AssignedTask[], byUserId: string): Promise<void> {
  const byAssignee = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.assigneeId === byUserId) continue;
    byAssignee.set(t.assigneeId, [...(byAssignee.get(t.assigneeId) ?? []), t.title]);
  }
  if (!byAssignee.size) return;

  try {
    const author = await prisma.user.findUnique({ where: { id: byUserId }, select: { fullName: true } });
    const from = author ? `От: ${author.fullName}\n` : '';

    const messages = [...byAssignee].map(([userId, titles]) => {
      const list = titles.slice(0, MAX_TITLES).map((t) => `• ${t.split('\n')[0]}`).join('\n');
      const more = titles.length > MAX_TITLES ? `\n…и ещё ${titles.length - MAX_TITLES}` : '';
      return {
        userId,
        title: titles.length === 1 ? 'Новая задача' : `Новые задачи: ${titles.length}`,
        body: `${from}${list}${more}`,
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
    console.error('notifyTasksAssigned failed:', (err as Error).message);
  }
}
