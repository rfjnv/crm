import prisma from '../../lib/prisma';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';

const TICK_MS = 30_000;
const MAX_ROWS_PER_TICK = 200;
const REMINDER_TITLE = 'Напоминание по обзвону';

function buildReminderLink(rowId: string, nextCallAt: Date): string {
  const key = `${rowId}:${nextCallAt.toISOString()}`;
  return `/notes-board?reminder=${encodeURIComponent(key)}`;
}

function buildReminderBody(companyName: string, comment: string): string {
  const trimmed = (comment || '').trim();
  if (!trimmed) return `Пора связаться с клиентом: ${companyName}`;
  const snippet = trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  return `Пора связаться с клиентом: ${companyName}. ${snippet}`;
}

async function tick(): Promise<void> {
  const now = new Date();
  const dueRows = await prisma.notesBoardRow.findMany({
    where: {
      nextCallAt: {
        lte: now,
      },
    },
    orderBy: {
      nextCallAt: 'asc',
    },
    take: MAX_ROWS_PER_TICK,
    select: {
      id: true,
      authorId: true,
      nextCallAt: true,
      comment: true,
      client: {
        select: {
          companyName: true,
        },
      },
    },
  });

  for (const row of dueRows) {
    if (!row.nextCallAt) continue;
    const link = buildReminderLink(row.id, row.nextCallAt);
    const alreadyExists = await prisma.notification.findFirst({
      where: {
        userId: row.authorId,
        title: REMINDER_TITLE,
        link,
      },
      select: { id: true },
    });
    if (alreadyExists) continue;

    const body = buildReminderBody(row.client.companyName, row.comment);
    await prisma.notification.create({
      data: {
        userId: row.authorId,
        title: REMINDER_TITLE,
        body,
        severity: 'INFO',
        link,
        createdByUserId: row.authorId,
      },
    });

    void pushService.sendPushToUser(row.authorId, {
      title: REMINDER_TITLE,
      body,
      url: '/notes-board',
      severity: 'INFO',
    }).catch(() => {});
    void telegramService.sendToUser(row.authorId, {
      title: REMINDER_TITLE,
      body,
      url: '/notes-board',
      severity: 'INFO',
    }).catch(() => {});
  }
}

setInterval(() => {
  void tick().catch((err) => {
    console.error('[notes-board-reminders] scheduler failed:', (err as Error).message);
  });
}, TICK_MS);

