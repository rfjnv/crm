import { AuditAction, Prisma } from '@prisma/client';
import prisma from './prisma';
import { getRequestContext } from './requestContext';

interface AuditParams {
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
  /** Обычно не нужно указывать явно — подхватывается из request context (см. requestContext.ts) */
  ip?: string;
  userAgent?: string;
  deviceId?: string;
}

export async function auditLog(params: AuditParams): Promise<void> {
  try {
    const ctx = getRequestContext();
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        before: (params.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        after: (params.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        reason: params.reason ?? null,
        ip: params.ip ?? ctx?.ip ?? null,
        userAgent: params.userAgent ?? ctx?.userAgent ?? null,
        deviceId: params.deviceId ?? ctx?.deviceId ?? null,
      },
    });
  } catch (err) {
    // Audit logging should never break main flow
    console.error('Failed to write audit log:', err);
  }
}
