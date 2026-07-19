import { ActivityEventType } from '@prisma/client';
import prisma from '../../lib/prisma';
import { getRequestContext } from '../../lib/requestContext';
import { AppError } from '../../lib/errors';

/** Разрыв между heartbeat-ами, после которого считаем, что началась новая сессия активности. */
const SESSION_GAP_MS = 3 * 60 * 1000;
/** Минимальная длительность сессии — чтобы одиночный heartbeat не считался нулевой активностью. */
const MIN_SESSION_MS = 60 * 1000;

interface PageViewEntry {
  path: string;
  at: string;
}

interface SessionEntry {
  start: string;
  end: string;
  durationMinutes: number;
}

export interface DailyActivityReport {
  userId: string;
  date: string;
  pageViews: PageViewEntry[];
  sessions: SessionEntry[];
  totalActiveMinutes: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
}

export async function logActivityEvent(
  userId: string,
  type: ActivityEventType,
  path: string,
): Promise<void> {
  const ctx = getRequestContext();
  await prisma.userActivityEvent.create({
    data: {
      userId,
      type,
      path: path.slice(0, 300),
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      deviceId: ctx?.deviceId ?? null,
    },
  });
}

function parseDate(dateISO: string): { start: Date; end: Date } {
  const start = new Date(`${dateISO}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    throw new AppError(400, 'Некорректная дата');
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function getDailyActivityReport(userId: string, dateISO: string): Promise<DailyActivityReport> {
  const { start, end } = parseDate(dateISO);

  const events = await prisma.userActivityEvent.findMany({
    where: { userId, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: 'asc' },
  });

  const pageViews: PageViewEntry[] = events
    .filter((e) => e.type === 'PAGE_VIEW')
    .map((e) => ({ path: e.path, at: e.createdAt.toISOString() }));

  const heartbeats = events.filter((e) => e.type === 'HEARTBEAT');

  const sessions: SessionEntry[] = [];
  let sessionStart: Date | null = null;
  let sessionEnd: Date | null = null;

  for (const hb of heartbeats) {
    if (!sessionStart || !sessionEnd) {
      sessionStart = hb.createdAt;
      sessionEnd = hb.createdAt;
      continue;
    }
    const gap = hb.createdAt.getTime() - sessionEnd.getTime();
    if (gap > SESSION_GAP_MS) {
      sessions.push(buildSession(sessionStart, sessionEnd));
      sessionStart = hb.createdAt;
    }
    sessionEnd = hb.createdAt;
  }
  if (sessionStart && sessionEnd) {
    sessions.push(buildSession(sessionStart, sessionEnd));
  }

  const totalActiveMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);

  const allTimes = events.map((e) => e.createdAt.getTime());
  const firstEventAt = allTimes.length ? new Date(Math.min(...allTimes)).toISOString() : null;
  const lastEventAt = allTimes.length ? new Date(Math.max(...allTimes)).toISOString() : null;

  return {
    userId,
    date: dateISO,
    pageViews,
    sessions,
    totalActiveMinutes,
    firstEventAt,
    lastEventAt,
  };
}

function buildSession(start: Date, lastHeartbeat: Date): SessionEntry {
  const rawDurationMs = lastHeartbeat.getTime() - start.getTime();
  const durationMs = Math.max(rawDurationMs, MIN_SESSION_MS);
  const end = new Date(start.getTime() + durationMs);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes: Math.round(durationMs / 60000),
  };
}
