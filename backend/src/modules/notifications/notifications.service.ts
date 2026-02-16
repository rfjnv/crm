import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import type { BroadcastDto } from './notifications.dto';

interface FindAllOptions {
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export class NotificationsService {
  async findAll(userId: string, options: FindAllOptions = {}) {
    const { unreadOnly = false, limit = 20, cursor } = options;
    const take = Math.min(limit, 50);

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const notifications = await prisma.notification.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = notifications.length > take;
    const items = hasMore ? notifications.slice(0, take) : notifications;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }

  async getUnreadCount(userId: string) {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markRead(id: string, userId: string) {
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new AppError(404, 'Уведомление не найдено');
    }

    if (notification.isRead) {
      return notification;
    }

    return prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return { updated: result.count };
  }

  async resolveTargetUsers(targets: BroadcastDto['targets']) {
    switch (targets.type) {
      case 'ALL':
        return prisma.user.findMany({
          where: { isActive: true },
          select: { id: true, fullName: true, role: true },
        });

      case 'USERS':
        return prisma.user.findMany({
          where: { id: { in: targets.userIds }, isActive: true },
          select: { id: true, fullName: true, role: true },
        });

      case 'ROLES':
        return prisma.user.findMany({
          where: { role: { in: targets.roles as Role[] }, isActive: true },
          select: { id: true, fullName: true, role: true },
        });

      case 'DEALS_COUNT': {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - targets.periodDays);

        const operatorMap: Record<string, string> = {
          LT: '<',
          GT: '>',
          LTE: '<=',
          GTE: '>=',
        };
        const sqlOp = operatorMap[targets.operator];

        const roleCondition = targets.roleFilter
          ? `AND u.role = '${targets.roleFilter}'`
          : '';

        const users = await prisma.$queryRawUnsafe<{ id: string; full_name: string; role: string; deal_count: string }[]>(
          `SELECT u.id, u.full_name, u.role, COUNT(d.id)::text as deal_count
           FROM users u
           LEFT JOIN deals d ON d.manager_id = u.id AND d.created_at >= $1 AND d.is_archived = false
           WHERE u.is_active = true ${roleCondition}
           GROUP BY u.id, u.full_name, u.role
           HAVING COUNT(d.id) ${sqlOp} $2`,
          cutoffDate,
          targets.value,
        );

        return users.map((u) => ({
          id: u.id,
          fullName: u.full_name,
          role: u.role as Role,
        }));
      }

      default:
        throw new AppError(400, 'Неизвестный тип таргета');
    }
  }

  async broadcast(dto: BroadcastDto, userId: string) {
    const targetUsers = await this.resolveTargetUsers(dto.targets);

    if (targetUsers.length === 0) {
      throw new AppError(400, 'Нет получателей для рассылки');
    }

    // Create batch and notifications in transaction
    const batch = await prisma.$transaction(async (tx) => {
      const batch = await tx.notificationBatch.create({
        data: {
          createdByUserId: userId,
          targetType: dto.targets.type,
          targetPayload: dto.targets as unknown as Prisma.InputJsonValue,
          title: dto.title,
          recipientCount: targetUsers.length,
        },
      });

      await tx.notification.createMany({
        data: targetUsers.map((user) => ({
          userId: user.id,
          title: dto.title,
          body: dto.body,
          severity: dto.severity,
          link: dto.link || null,
          createdByUserId: userId,
          batchId: batch.id,
        })),
      });

      return batch;
    });

    await auditLog({
      userId,
      action: 'NOTIFICATION_BROADCAST',
      entityType: 'notification_batch',
      entityId: batch.id,
      after: {
        targetType: dto.targets.type,
        recipientCount: targetUsers.length,
        title: dto.title,
        severity: dto.severity,
      },
    });

    return {
      batchId: batch.id,
      recipientCount: targetUsers.length,
    };
  }

  async previewRecipients(targets: BroadcastDto['targets']) {
    const users = await this.resolveTargetUsers(targets);
    return {
      count: users.length,
      users: users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        role: u.role,
      })),
    };
  }
}

export const notificationsService = new NotificationsService();
