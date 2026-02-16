import { AuditAction, Prisma } from '@prisma/client';
import prisma from './prisma';

interface AuditParams {
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function auditLog(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        before: (params.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        after: (params.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Audit logging should never break main flow
    console.error('Failed to write audit log:', err);
  }
}
