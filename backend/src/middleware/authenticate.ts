import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt';
import type { AccessTokenPayload } from '../lib/jwt';
import { AppError } from '../lib/errors';
import { canAccessCrmApi } from '../lib/crmAccess';
import prisma from '../lib/prisma';

declare global {
  namespace Express {
    interface Request {
      /** Актуальные поля из БД + sessionId из access JWT (если есть) */
      user?: AccessTokenPayload;
    }
  }
}

/**
 * Проверяет JWT, затем подставляет актуальные role и permissions из БД,
 * чтобы смена прав в «Пользователях» применялась без перелогина.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError(401, 'Токен не предоставлен'));
    return;
  }

  const token = header.slice(7);

  void (async () => {
    try {
      const payload = verifyAccessToken(token);
      const row = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true, permissions: true, isActive: true, companyId: true },
      });

      if (!row?.isActive) {
        next(new AppError(401, 'Пользователь не найден или деактивирован'));
        return;
      }

      const permissions = Array.isArray(row.permissions)
        ? (row.permissions as string[])
        : [];

      req.user = {
        userId: row.id,
        role: row.role,
        permissions,
        ...(row.companyId ? { companyId: row.companyId } : {}),
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        ...(payload.supabaseUserId ? { supabaseUserId: payload.supabaseUserId } : {}),
      };

      if (!canAccessCrmApi(req.originalUrl, row.role as Role, payload.supabaseUserId)) {
        next(new AppError(403, 'Доступ к CRM только для сотрудников (вход по логину)'));
        return;
      }

      next();
    } catch {
      next(new AppError(401, 'Недействительный или истёкший токен'));
    }
  })();
}
