import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

export interface AuditLogListQuery {
  userId?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

function parseOptionalDate(value: string | undefined, label: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, `Некорректная дата: ${label}`);
  }
  return d;
}

export async function listAuditLogsForSuperAdmin(query: AuditLogListQuery) {
  let limit = 100;
  if (query.limit !== undefined) {
    if (!Number.isFinite(query.limit) || query.limit < 1) {
      throw new AppError(400, 'Некорректный limit');
    }
    limit = Math.min(query.limit, 500);
  }
  let offset = 0;
  if (query.offset !== undefined) {
    if (!Number.isFinite(query.offset) || query.offset < 0) {
      throw new AppError(400, 'Некорректный offset');
    }
    offset = query.offset;
  }

  const from = parseOptionalDate(query.from, 'from');
  const to = parseOptionalDate(query.to, 'to');
  if (from && to && from > to) {
    throw new AppError(400, 'Параметр from не может быть позже to');
  }

  const where: Prisma.AuditLogWhereInput = {};
  if (query.userId) where.userId = query.userId;
  if (query.entityId) where.entityId = query.entityId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: { select: { id: true, fullName: true, login: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items: items.map((row) => ({
      id: row.id,
      userId: row.userId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      oldValue: row.before,
      newValue: row.after,
      reason: row.reason,
      createdAt: row.createdAt,
      user: row.user,
    })),
    total,
    limit,
    offset,
  };
}
