import { createHash, randomBytes } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

/** Телефон, от имени которого пришёл запрос (после authenticateDevice). */
export interface DeviceContext {
  id: string;
  userId: string;
  model: string | null;
  recordingsPathOverride: string | null;
  simSlot: number | null;
  uploadLogsRequested: boolean;
}

declare global {
  namespace Express {
    interface Request {
      device?: DeviceContext;
    }
  }
}

/** 32 случайных байта в base64url. JWT CRM телефону не подходит: он короткоживущий, а нужен долгоживущий и отзываемый. */
export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

/** В БД лежит только SHA-256 токена. */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** lastSeenAt обновляем не чаще раза в минуту — телефон шлёт пачки запросов подряд. */
const TOUCH_EVERY_MS = 60_000;

/**
 * `Authorization: Bearer <device_token>` → активное устройство и активный сотрудник.
 * Иначе 401: приложение по нему понимает, что телефон отвязан, и просит войти заново.
 */
export function authenticateDevice(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError(401, 'Телефон не привязан: нет токена устройства'));
    return;
  }
  const token = header.slice(7).trim();

  void (async () => {
    try {
      const device = token
        ? await prisma.mobileDevice.findUnique({
          where: { tokenHash: hashDeviceToken(token) },
          select: {
            id: true,
            userId: true,
            active: true,
            model: true,
            recordingsPathOverride: true,
            simSlot: true,
            uploadLogsRequested: true,
            lastSeenAt: true,
            user: { select: { id: true, role: true, permissions: true, isActive: true, moneyAccess: true } },
          },
        })
        : null;
      if (!device || !device.active || !device.user.isActive) {
        next(new AppError(401, 'Телефон отвязан от CRM. Войдите в приложении заново.'));
        return;
      }

      req.device = {
        id: device.id,
        userId: device.userId,
        model: device.model,
        recordingsPathOverride: device.recordingsPathOverride,
        simSlot: device.simSlot,
        uploadLogsRequested: device.uploadLogsRequested,
      };
      req.user = {
        userId: device.user.id,
        role: device.user.role,
        permissions: device.user.permissions,
        moneyAccess: device.user.moneyAccess,
      };

      const now = new Date();
      if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
        // Телефон снова на связи — эпизод «молчит» закончился, следующий алерт можно слать заново
        prisma.mobileDevice
          .update({ where: { id: device.id }, data: { lastSeenAt: now, silentAlertedAt: null } })
          .catch((err) => console.error('[mobile] touch device failed:', (err as Error).message));
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}
