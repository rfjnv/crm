import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { comparePassword, hashPassword } from '../../lib/password';
import type { UpdateProfileDto } from './profile.dto';

function formatDayCell(day: unknown): string {
  if (day instanceof Date) {
    const y = day.getFullYear();
    const m = String(day.getMonth() + 1).padStart(2, '0');
    const d = String(day.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(day);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Границы дня в локальном времени сервера (как в KPI пользователей). */
function parseYmdLocal(day: string, endOfDay: boolean): Date {
  const [y, m, d] = day.split('-').map(Number);
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
}

export class ProfileService {
  async updateOwnProfile(userId: string, dto: UpdateProfileDto) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new AppError(404, 'Пользователь не найден');
    }

    const data: { login?: string; fullName?: string; password?: string } = {};

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName;
    } else if (dto.firstName !== undefined) {
      const ln = (dto.lastName ?? '').trim();
      data.fullName = ln ? `${dto.firstName.trim()} ${ln}` : dto.firstName.trim();
    }

    if (dto.login !== undefined && dto.login !== user.login) {
      const taken = await prisma.user.findUnique({ where: { login: dto.login } });
      if (taken) {
        throw new AppError(409, 'Этот логин уже занят');
      }
      data.login = dto.login;
    }

    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new AppError(400, 'Укажите текущий пароль');
      }
      const ok = await comparePassword(dto.currentPassword, user.password);
      if (!ok) {
        throw new AppError(403, 'Неверный текущий пароль');
      }
      data.password = await hashPassword(dto.newPassword);
    }

    if (Object.keys(data).length === 0) {
      throw new AppError(400, 'Нет данных для обновления');
    }

    return prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        login: true,
        fullName: true,
        role: true,
        permissions: true,
        isActive: true,
        createdAt: true,
        badgeIcon: true,
        badgeColor: true,
      },
    });
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const now = new Date();
    const rows = await prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        ip: true,
        userAgent: true,
        expiresAt: true,
      },
    });

    return rows.map((s) => ({
      ...s,
      isCurrent: !!currentSessionId && s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const res = await prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) {
      throw new AppError(404, 'Сессия не найдена или уже завершена');
    }
    return { success: true };
  }

  async dailyReport(userId: string, fromDay: string, toDay: string) {
    const from = parseYmdLocal(fromDay, false);
    const to = parseYmdLocal(toDay, true);
    if (from > to) {
      throw new AppError(400, 'Некорректный диапазон дат');
    }
    const maxSpanMs = 400 * 86400000;
    if (to.getTime() - from.getTime() > maxSpanMs) {
      throw new AppError(400, 'Интервал не более 400 дней');
    }

    const [createdRaw, closedRaw, revenueRaw] = await Promise.all([
      prisma.$queryRaw<{ day: string; count: bigint }[]>(
        Prisma.sql`SELECT DATE(created_at) AS day, COUNT(*)::bigint AS count
        FROM deals
        WHERE manager_id = ${userId} AND created_at >= ${from} AND created_at <= ${to}
        GROUP BY DATE(created_at)
        ORDER BY day`,
      ),
      prisma.$queryRaw<{ day: string; count: bigint }[]>(
        Prisma.sql`SELECT DATE(closed_at) AS day, COUNT(*)::bigint AS count
        FROM deals
        WHERE manager_id = ${userId} AND status = 'CLOSED' AND closed_at IS NOT NULL
          AND closed_at >= ${from} AND closed_at <= ${to}
        GROUP BY DATE(closed_at)
        ORDER BY day`,
      ),
      prisma.$queryRaw<{ day: string; total: unknown }[]>(
        Prisma.sql`SELECT DATE(p.paid_at) AS day, SUM(p.amount)::numeric AS total
        FROM payments p
        INNER JOIN deals d ON d.id = p.deal_id
        WHERE d.manager_id = ${userId} AND p.paid_at >= ${from} AND p.paid_at <= ${to}
        GROUP BY DATE(p.paid_at)
        ORDER BY day`,
      ),
    ]);

    const byDay = new Map<
      string,
      { date: string; dealsCreated: number; dealsClosed: number; revenue: number }
    >();

    const ensure = (day: string) => {
      if (!byDay.has(day)) {
        byDay.set(day, { date: day, dealsCreated: 0, dealsClosed: 0, revenue: 0 });
      }
      return byDay.get(day)!;
    };

    for (const r of createdRaw) {
      const day = formatDayCell(r.day);
      ensure(day).dealsCreated = Number(r.count);
    }
    for (const r of closedRaw) {
      const day = formatDayCell(r.day);
      ensure(day).dealsClosed = Number(r.count);
    }
    for (const r of revenueRaw) {
      const day = formatDayCell(r.day);
      ensure(day).revenue = r.total != null ? Number(r.total) : 0;
    }

    const days = [...byDay.keys()].sort().map((d) => byDay.get(d)!);

    const totals = days.reduce(
      (acc, d) => ({
        dealsCreated: acc.dealsCreated + d.dealsCreated,
        dealsClosed: acc.dealsClosed + d.dealsClosed,
        revenue: acc.revenue + d.revenue,
      }),
      { dealsCreated: 0, dealsClosed: 0, revenue: 0 },
    );

    return { days, totals, from: fromDay, to: toDay };
  }
}

export const profileService = new ProfileService();
