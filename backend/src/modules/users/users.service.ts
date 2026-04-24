import prisma from '../../lib/prisma';
import { hashPassword } from '../../lib/password';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { DEFAULT_PERMISSIONS } from '../../lib/permissions';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';
import { CreateUserDto, UpdateUserDto, UpsertMonthlyGoalDto } from './users.dto';

const userSelect = {
  id: true,
  login: true,
  fullName: true,
  department: true,
  role: true,
  permissions: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  badgeIcon: true,
  badgeColor: true,
  badgeLabel: true,
};

export class UsersService {
  private resolveGoalPeriod(year?: number, month?: number) {
    const now = new Date();
    return {
      year: year ?? now.getFullYear(),
      month: month ?? now.getMonth() + 1,
    };
  }

  private getMonthRange(year: number, month: number) {
    const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const to = new Date(year, month, 1, 0, 0, 0, 0);
    return { from, to };
  }

  private async calculateActuals(userId: string, year: number, month: number) {
    const { from, to } = this.getMonthRange(year, month);
    const [dealsClosed, revenueAgg, callNotes] = await Promise.all([
      prisma.deal.count({
        where: {
          managerId: userId,
          status: 'CLOSED',
          closedAt: { gte: from, lt: to },
        },
      }),
      prisma.payment.aggregate({
        where: {
          deal: { managerId: userId },
          paidAt: { gte: from, lt: to },
        },
        _sum: { amount: true },
      }),
      prisma.clientNote.count({
        where: {
          userId,
          deletedAt: null,
          createdAt: { gte: from, lt: to },
        },
      }),
    ]);
    return {
      dealsClosed,
      revenue: revenueAgg._sum.amount ? Number(revenueAgg._sum.amount) : 0,
      callNotes,
    };
  }

  private calcPercent(actual: number, target: number | null) {
    if (!target || target <= 0) return null;
    return Math.round((actual / target) * 100);
  }

  /**
   * По умолчанию только активные (команда, селекты менеджеров).
   * `includeInactive: true` — полный список (только ADMIN/SUPER_ADMIN в контроллере).
   */
  async findAll(opts?: { includeInactive?: boolean }) {
    return prisma.user.findMany({
      where: opts?.includeInactive ? undefined : { isActive: true },
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateUserDto, performedBy: string) {
    const exists = await prisma.user.findUnique({ where: { login: dto.login } });
    if (exists) {
      throw new AppError(409, 'Пользователь с таким логином уже существует');
    }

    const hashed = await hashPassword(dto.password);
    const permissions = dto.permissions ?? DEFAULT_PERMISSIONS[dto.role] ?? [];

    const dept = dto.department?.trim();
    const user = await prisma.user.create({
      data: {
        login: dto.login,
        password: hashed,
        fullName: dto.fullName,
        department: dept || null,
        role: dto.role,
        permissions,
      },
      select: userSelect,
    });

    await auditLog({
      userId: performedBy,
      action: 'CREATE',
      entityType: 'user',
      entityId: user.id,
      after: {
        login: user.login,
        fullName: user.fullName,
        department: user.department,
        role: user.role,
        permissions: user.permissions,
      },
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, performedBy: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError(404, 'Пользователь не найден');
    }

    // Protect SUPER_ADMIN from non-SUPER_ADMIN
    if (user.role === 'SUPER_ADMIN') {
      const performer = await prisma.user.findUnique({ where: { id: performedBy }, select: { role: true } });
      if (performer?.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Нельзя редактировать суперадминистратора');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.login !== undefined) data.login = dto.login;
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.department !== undefined) {
      data.department = dto.department === null || dto.department === '' ? null : dto.department.trim();
    }
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password !== undefined) data.password = await hashPassword(dto.password);
    if (dto.permissions !== undefined) data.permissions = dto.permissions;
    if (dto.badgeIcon !== undefined) data.badgeIcon = dto.badgeIcon;
    if (dto.badgeColor !== undefined) data.badgeColor = dto.badgeColor;
    if (dto.badgeLabel !== undefined) data.badgeLabel = dto.badgeLabel;

    if (Object.keys(data).length === 0) {
      throw new AppError(400, 'Нет данных для обновления');
    }

    const before = {
      login: user.login,
      fullName: user.fullName,
      department: user.department,
      role: user.role,
      isActive: user.isActive,
      permissions: user.permissions,
      badgeIcon: user.badgeIcon,
      badgeColor: user.badgeColor,
      badgeLabel: user.badgeLabel,
    };

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: userSelect,
    });

    const norm = (v: string | null | undefined) => v ?? null;
    const badgeTouched = dto.badgeLabel !== undefined || dto.badgeIcon !== undefined || dto.badgeColor !== undefined;
    const badgeChanged =
      badgeTouched &&
      (norm(updated.badgeLabel) !== norm(before.badgeLabel) ||
        norm(updated.badgeIcon) !== norm(before.badgeIcon) ||
        norm(updated.badgeColor) !== norm(before.badgeColor));
    if (badgeChanged) {
      await prisma.userMedalHistory.create({
        data: {
          userId: id,
          badgeLabel: updated.badgeLabel,
          badgeIcon: updated.badgeIcon,
          badgeColor: updated.badgeColor,
          grantedById: performedBy,
        },
      });

      const medalTitle = 'Вам выдана медаль';
      const label = updated.badgeLabel?.trim();
      const medalBody = label
        ? `Новая награда: «${label}». Поздравляем!`
        : 'Вам присвоена новая медаль — откройте профиль, чтобы посмотреть.';

      await prisma.notification.create({
        data: {
          userId: id,
          title: medalTitle,
          body: medalBody,
          severity: 'WARNING',
          link: '/profile',
          createdByUserId: performedBy,
        },
      });

      const pushPayload = {
        title: medalTitle,
        body: medalBody,
        url: '/profile',
        severity: 'WARNING' as const,
      };
      pushService.sendPushToUser(id, pushPayload).catch(() => {});
      telegramService.sendToUser(id, pushPayload).catch(() => {});
    }

    await auditLog({
      userId: performedBy,
      action: 'UPDATE',
      entityType: 'user',
      entityId: id,
      before,
      after: {
        login: updated.login,
        fullName: updated.fullName,
        department: updated.department,
        role: updated.role,
        isActive: updated.isActive,
        permissions: updated.permissions,
        badgeIcon: updated.badgeIcon,
        badgeColor: updated.badgeColor,
        badgeLabel: updated.badgeLabel,
      },
    });

    return updated;
  }

  async deactivate(id: string, performedBy: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError(404, 'Пользователь не найден');
    }

    if (id === performedBy) {
      throw new AppError(400, 'Нельзя деактивировать самого себя');
    }

    // Protect SUPER_ADMIN
    if (user.role === 'SUPER_ADMIN') {
      const performer = await prisma.user.findUnique({ where: { id: performedBy }, select: { role: true } });
      if (performer?.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Только суперадминистратор может деактивировать суперадминистратора');
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: userSelect,
    });

    // Revoke all sessions
    await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await auditLog({
      userId: performedBy,
      action: 'ARCHIVE',
      entityType: 'user',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return updated;
  }

  async deleteUser(id: string, performedBy: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError(404, 'Пользователь не найден');
    }

    if (id === performedBy) {
      throw new AppError(400, 'Нельзя удалить самого себя');
    }

    // Protect SUPER_ADMIN
    if (user.role === 'SUPER_ADMIN') {
      const performer = await prisma.user.findUnique({ where: { id: performedBy }, select: { role: true } });
      if (performer?.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Только суперадминистратор может удалить суперадминистратора');
      }
      const superAdminCount = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
      if (superAdminCount <= 1) {
        throw new AppError(400, 'Нельзя удалить последнего суперадминистратора');
      }
    }

    // Check for related data
    const [dealsCount, clientsCount] = await Promise.all([
      prisma.deal.count({ where: { managerId: id } }),
      prisma.client.count({ where: { managerId: id } }),
    ]);

    if (dealsCount > 0 || clientsCount > 0) {
      throw new AppError(400,
        `Невозможно удалить: у пользователя есть ${dealsCount} сделок и ${clientsCount} клиентов. Используйте деактивацию.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.notification.deleteMany({ where: { userId: id } });
      await tx.conversationRead.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });

    await auditLog({
      userId: performedBy,
      action: 'DELETE',
      entityType: 'user',
      entityId: id,
      before: { login: user.login, fullName: user.fullName, role: user.role },
    });

    return { success: true };
  }

  async activate(id: string, performedBy: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError(404, 'Пользователь не найден');
    }

    if (user.isActive) {
      throw new AppError(400, 'Пользователь уже активен');
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: userSelect,
    });

    await auditLog({
      userId: performedBy,
      action: 'RESTORE',
      entityType: 'user',
      entityId: id,
      before: { isActive: false },
      after: { isActive: true },
    });

    return updated;
  }

  async upsertMonthlyGoal(userId: string, dto: UpsertMonthlyGoalDto, performerId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new AppError(404, 'Пользователь не найден');
    }
    const { year, month } = this.resolveGoalPeriod(dto.year, dto.month);
    const row = await prisma.userMonthlyGoal.upsert({
      where: { userId_year_month: { userId, year, month } },
      create: {
        userId,
        year,
        month,
        dealsTarget: dto.dealsTarget,
        revenueTarget: dto.revenueTarget,
        callNotesTarget: dto.callNotesTarget,
        updatedById: performerId,
      },
      update: {
        dealsTarget: dto.dealsTarget,
        revenueTarget: dto.revenueTarget,
        callNotesTarget: dto.callNotesTarget,
        updatedById: performerId,
      },
      select: {
        id: true,
        userId: true,
        year: true,
        month: true,
        dealsTarget: true,
        revenueTarget: true,
        callNotesTarget: true,
        updatedAt: true,
        updatedBy: { select: { fullName: true } },
      },
    });

    await auditLog({
      userId: performerId,
      action: 'UPDATE',
      entityType: 'user_goal',
      entityId: row.id,
      after: {
        userId,
        year,
        month,
        dealsTarget: row.dealsTarget,
        revenueTarget: row.revenueTarget,
        callNotesTarget: row.callNotesTarget,
      },
    });

    const actual = await this.calculateActuals(userId, year, month);
    const revenueTarget = row.revenueTarget != null ? Number(row.revenueTarget) : null;

    return {
      userId: row.userId,
      year: row.year,
      month: row.month,
      targets: {
        deals: row.dealsTarget,
        revenue: revenueTarget,
        callNotes: row.callNotesTarget,
      },
      actual,
      progress: {
        deals: this.calcPercent(actual.dealsClosed, row.dealsTarget),
        revenue: this.calcPercent(actual.revenue, revenueTarget),
        callNotes: this.calcPercent(actual.callNotes, row.callNotesTarget),
      },
      updatedAt: row.updatedAt.toISOString(),
      updatedByName: row.updatedBy?.fullName ?? null,
    };
  }

  async getMonthlyGoalProgress(userId: string, year?: number, month?: number) {
    const p = this.resolveGoalPeriod(year, month);
    const row = await prisma.userMonthlyGoal.findUnique({
      where: { userId_year_month: { userId, year: p.year, month: p.month } },
      select: {
        userId: true,
        year: true,
        month: true,
        dealsTarget: true,
        revenueTarget: true,
        callNotesTarget: true,
        updatedAt: true,
        updatedBy: { select: { fullName: true } },
      },
    });

    const actual = await this.calculateActuals(userId, p.year, p.month);
    const revenueTarget = row?.revenueTarget != null ? Number(row.revenueTarget) : null;
    return {
      userId,
      year: p.year,
      month: p.month,
      targets: {
        deals: row?.dealsTarget ?? null,
        revenue: revenueTarget,
        callNotes: row?.callNotesTarget ?? null,
      },
      actual,
      progress: {
        deals: this.calcPercent(actual.dealsClosed, row?.dealsTarget ?? null),
        revenue: this.calcPercent(actual.revenue, revenueTarget),
        callNotes: this.calcPercent(actual.callNotes, row?.callNotesTarget ?? null),
      },
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedByName: row?.updatedBy?.fullName ?? null,
    };
  }

  async listMonthlyGoalsForPeriod(year?: number, month?: number) {
    const p = this.resolveGoalPeriod(year, month);
    const rows = await prisma.userMonthlyGoal.findMany({
      where: { year: p.year, month: p.month },
      select: {
        userId: true,
        year: true,
        month: true,
        dealsTarget: true,
        revenueTarget: true,
        callNotesTarget: true,
        updatedAt: true,
        updatedBy: { select: { fullName: true } },
      },
    });

    const result = await Promise.all(
      rows.map(async (row) => {
        const actual = await this.calculateActuals(row.userId, row.year, row.month);
        const revenueTarget = row.revenueTarget != null ? Number(row.revenueTarget) : null;
        return {
          userId: row.userId,
          year: row.year,
          month: row.month,
          targets: {
            deals: row.dealsTarget,
            revenue: revenueTarget,
            callNotes: row.callNotesTarget,
          },
          actual,
          progress: {
            deals: this.calcPercent(actual.dealsClosed, row.dealsTarget),
            revenue: this.calcPercent(actual.revenue, revenueTarget),
            callNotes: this.calcPercent(actual.callNotes, row.callNotesTarget),
          },
          updatedAt: row.updatedAt.toISOString(),
          updatedByName: row.updatedBy?.fullName ?? null,
        };
      }),
    );

    return result;
  }

  async listMedalHistory(targetUserId: string, actor: { userId: string; role: string }) {
    const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
    if (!isAdmin && actor.userId !== targetUserId) {
      throw new AppError(403, 'Нет доступа к истории медалей');
    }
    const rows = await prisma.userMedalHistory.findMany({
      where: { userId: targetUserId, removedAt: null },
      orderBy: { grantedAt: 'desc' },
      select: {
        id: true,
        badgeLabel: true,
        badgeIcon: true,
        badgeColor: true,
        grantedAt: true,
        grantedBy: { select: { fullName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      badgeLabel: r.badgeLabel,
      badgeIcon: r.badgeIcon,
      badgeColor: r.badgeColor,
      grantedAt: r.grantedAt.toISOString(),
      grantedByName: r.grantedBy?.fullName ?? null,
    }));
  }

  async removeMedalHistoryEntry(entryId: string, targetUserId: string, performerId: string) {
    const performer = await prisma.user.findUnique({ where: { id: performerId }, select: { role: true } });
    if (performer?.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только суперадминистратор может скрыть запись в истории медалей');
    }
    const row = await prisma.userMedalHistory.findFirst({
      where: { id: entryId, userId: targetUserId, removedAt: null },
    });
    if (!row) {
      throw new AppError(404, 'Запись не найдена');
    }
    await prisma.userMedalHistory.update({
      where: { id: entryId },
      data: { removedAt: new Date(), removedById: performerId },
    });
    return { success: true };
  }
}

export const usersService = new UsersService();
