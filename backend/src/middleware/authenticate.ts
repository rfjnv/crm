import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt';
import type { AccessTokenPayload } from '../lib/jwt';
import { AppError } from '../lib/errors';
import { canAccessCrmApi } from '../lib/crmAccess';
import { assertPathAllowed, redactMoney } from '../lib/moneyAccess';
import { canHaveCostAccess, hasCostAccess, redactCost } from '../lib/costAccess';
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
export function authenticate(req: Request, res: Response, next: NextFunction): void {
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
        select: { id: true, role: true, permissions: true, isActive: true, companyId: true, moneyAccess: true },
      });

      if (!row?.isActive) {
        next(new AppError(401, 'Пользователь не найден или деактивирован'));
        return;
      }

      // Себестоимость открыта только админам с введённым ПИН — срок живёт в сессии входа.
      const costSession = canHaveCostAccess(row.role) && payload.sessionId
        ? await prisma.session.findUnique({
          where: { id: payload.sessionId },
          select: { costUnlockedUntil: true, revokedAt: true },
        })
        : null;
      const costUnlockedUntil = costSession && !costSession.revokedAt ? costSession.costUnlockedUntil : null;

      const permissions = Array.isArray(row.permissions)
        ? (row.permissions as string[])
        : [];

      req.user = {
        userId: row.id,
        role: row.role,
        permissions,
        moneyAccess: row.moneyAccess,
        costUnlockedUntil,
        ...(row.companyId ? { companyId: row.companyId } : {}),
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        ...(payload.supabaseUserId ? { supabaseUserId: payload.supabaseUserId } : {}),
      };

      if (!canAccessCrmApi(req.originalUrl, row.role as Role, payload.supabaseUserId)) {
        next(new AppError(403, 'Доступ к CRM только для сотрудников (вход по логину)'));
        return;
      }

      // Ограничение доступа к деньгам — на сервере, чтобы не обходилось через F12.
      // Закрытые разделы получают 403; в остальных из ответа вычищаются денежные поля.
      if (row.moneyAccess !== 'FULL') {
        // originalUrl, а не req.path: authenticate висит внутри роутеров, и path там
        // относительный («/manager-kpi» вместо «/api/analytics/manager-kpi»).
        assertPathAllowed(row.moneyAccess, req.originalUrl.split('?')[0]);
      }
      const level = row.moneyAccess;
      const costOpen = hasCostAccess(req.user);
      if (level !== 'FULL' || !costOpen) {
        // Роутеры вкладываются друг в друга, и authenticate может сработать на запрос
        // дважды — оборачиваем res.json один раз.
        const tagged = res as Response & { __redactWrapped?: boolean };
        if (!tagged.__redactWrapped) {
          tagged.__redactWrapped = true;
          const originalJson = res.json.bind(res);
          res.json = (body: unknown) => {
            let out = redactMoney(body, level);
            if (!costOpen) out = redactCost(out);
            return originalJson(out);
          };
        }
      }

      next();
    } catch (err) {
      next(err instanceof AppError ? err : new AppError(401, 'Недействительный или истёкший токен'));
    }
  })();
}
