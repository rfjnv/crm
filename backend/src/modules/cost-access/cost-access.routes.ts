import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { comparePassword, hashPassword } from '../../lib/password';
import {
  COST_PIN_LOCK_MINUTES,
  COST_PIN_MAX_ATTEMPTS,
  COST_ROLES,
  COST_UNLOCK_MINUTES,
  hasCostAccess,
} from '../../lib/costAccess';

/**
 * Доступ к себестоимости по личному ПИН-коду (ADMIN / SUPER_ADMIN).
 *
 * ПИН хранится только bcrypt-хешем. Установить или сменить его можно лишь с паролем
 * от учётной записи — иначе любой, кто сел за незаблокированный компьютер админа,
 * поставил бы свой ПИН. После COST_PIN_MAX_ATTEMPTS ошибок ввод блокируется.
 * Открытый доступ живёт в текущей сессии входа (Session.costUnlockedUntil):
 * на другом устройстве того же админа он закрыт.
 */

const router = Router();
router.use(authenticate);

const pinSchema = z.string().regex(/^\d{4,8}$/, 'ПИН — от 4 до 8 цифр');

const setPinDto = z.object({
  password: z.string().min(1, 'Введите пароль от учётной записи'),
  pin: pinSchema,
});

const unlockDto = z.object({
  pin: z.string().min(1, 'Введите ПИН'),
  duration: z.enum(['short', 'long']).default('short'),
});

async function statusFor(req: Request) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { role: true, costPinHash: true, costPinLockedUntil: true },
  });
  const eligible = !!user && (COST_ROLES as readonly string[]).includes(user.role);
  const open = hasCostAccess(req.user);
  const lockedUntil = user?.costPinLockedUntil && user.costPinLockedUntil > new Date()
    ? user.costPinLockedUntil
    : null;
  return {
    eligible,
    hasPin: eligible && !!user?.costPinHash,
    unlockedUntil: open ? req.user!.costUnlockedUntil ?? null : null,
    lockedUntil,
    durations: COST_UNLOCK_MINUTES,
  };
}

router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  res.json(await statusFor(req));
}));

/** Установить или сменить свой ПИН. Требует пароль от учётной записи. */
router.post('/pin', authorize(...COST_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { password, pin } = setPinDto.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, password: true, costPinHash: true },
  });
  if (!user) throw new AppError(404, 'Пользователь не найден');
  if (!(await comparePassword(password, user.password))) {
    await auditLog({ userId: user.id, action: 'COST_UNLOCK_FAILED', entityType: 'cost_pin', after: { reason: 'wrong_password_on_pin_set' } });
    throw new AppError(400, 'Неверный пароль от учётной записи');
  }
  const hadPin = !!user.costPinHash;
  await prisma.user.update({
    where: { id: user.id },
    data: { costPinHash: await hashPassword(pin), costPinFailedAttempts: 0, costPinLockedUntil: null },
  });
  // Новый ПИН закрывает все открытые доступы этого админа: старый мог быть подсмотрен.
  await prisma.session.updateMany({ where: { userId: user.id }, data: { costUnlockedUntil: null } });
  await auditLog({ userId: user.id, action: 'COST_PIN_SET', entityType: 'cost_pin', entityId: user.id, after: { changed: hadPin } });
  res.json({ ok: true });
}));

router.post('/unlock', authorize(...COST_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const { pin, duration } = unlockDto.parse(req.body);
  const sessionId = req.user!.sessionId;
  if (!sessionId) throw new AppError(400, 'Войдите в CRM по логину и паролю, чтобы открыть себестоимость');

  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, costPinHash: true, costPinFailedAttempts: true, costPinLockedUntil: true },
  });
  if (!user?.costPinHash) throw new AppError(400, 'Сначала установите ПИН-код');

  const now = new Date();
  if (user.costPinLockedUntil && user.costPinLockedUntil > now) {
    const mins = Math.ceil((user.costPinLockedUntil.getTime() - now.getTime()) / 60_000);
    throw new AppError(429, `Слишком много неверных попыток. Попробуйте через ${mins} мин.`);
  }

  if (!(await comparePassword(pin, user.costPinHash))) {
    const attempts = user.costPinFailedAttempts + 1;
    const lock = attempts >= COST_PIN_MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: lock
        ? { costPinFailedAttempts: 0, costPinLockedUntil: new Date(now.getTime() + COST_PIN_LOCK_MINUTES * 60_000) }
        : { costPinFailedAttempts: attempts },
    });
    await auditLog({
      userId: user.id, action: 'COST_UNLOCK_FAILED', entityType: 'cost_pin', entityId: user.id,
      after: { attempts, locked: lock },
    });
    if (lock) throw new AppError(429, `Неверный ПИН. Ввод заблокирован на ${COST_PIN_LOCK_MINUTES} минут.`);
    throw new AppError(400, `Неверный ПИН. Осталось попыток: ${COST_PIN_MAX_ATTEMPTS - attempts}`);
  }

  const minutes = COST_UNLOCK_MINUTES[duration];
  const until = new Date(now.getTime() + minutes * 60_000);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { costPinFailedAttempts: 0, costPinLockedUntil: null } }),
    prisma.session.update({ where: { id: sessionId }, data: { costUnlockedUntil: until } }),
  ]);
  await auditLog({ userId: user.id, action: 'COST_UNLOCK', entityType: 'cost_pin', entityId: user.id, after: { minutes } });
  res.json({ unlockedUntil: until });
}));

router.post('/lock', asyncHandler(async (req: Request, res: Response) => {
  const sessionId = req.user!.sessionId;
  if (sessionId) {
    await prisma.session.update({ where: { id: sessionId }, data: { costUnlockedUntil: null } });
    if (req.user!.costUnlockedUntil) {
      await auditLog({ userId: req.user!.userId, action: 'COST_LOCK', entityType: 'cost_pin', entityId: req.user!.userId });
    }
  }
  res.json({ ok: true });
}));

/** Супер-админ сбрасывает ПИН сотруднику (забыл, уволился, подозрение на утечку). */
router.delete('/users/:id/pin', authorize('SUPER_ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) throw new AppError(404, 'Пользователь не найден');
  await prisma.user.update({
    where: { id },
    data: { costPinHash: null, costPinFailedAttempts: 0, costPinLockedUntil: null },
  });
  await prisma.session.updateMany({ where: { userId: id }, data: { costUnlockedUntil: null } });
  await auditLog({ userId: req.user!.userId, action: 'COST_PIN_RESET', entityType: 'user', entityId: id });
  res.json({ ok: true });
}));

export default router;
