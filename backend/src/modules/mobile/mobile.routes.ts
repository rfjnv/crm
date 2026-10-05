import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditLog } from '../../lib/logger';
import { canSeeAllCalls } from './mobile.access';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { byIp, byUserOrIp, hashKey, rateLimiter } from '../../middleware/rateLimiter';
import { authenticateDevice } from './mobile.device-auth';
import { deviceModelConfigDto, mobileSettingsDto, parseOr400, updateDeviceDto } from './mobile.dto';
import {
  authenticateMobile,
  createPairingCode,
  deviceConfig,
  heartbeat,
  MAX_LOG_BYTES,
  receiveLog,
} from './mobile.service';
import { listDevices, listDeviceModels } from './mobile.devices';
import { getMobileSettings, updateMobileSettings } from './mobile.settings';
import { signedUrl } from './mobile.storage';
import { config } from '../../lib/config';
import { archiveRecordings } from './mobile.archive';
import {
  connectDrive,
  disconnectDrive,
  DRIVE_ROOT_FOLDER_NAME,
  driveAuthUrl,
  driveRedirectUri,
  getDriveConnection,
  isDriveConfigured,
  verifyDriveState,
} from './mobile.drive';
import { removeTempUpload, singleFileUpload } from './mobile.upload';

const router = Router();
const WINDOW_15M = 15 * 60 * 1000;

/**
 * Подбор пароля к одному логину и перебор кодов привязки. Логин в ключе — в нижнем регистре
 * и хешем: логины кириллические, и «Иван» с «иван» должны считаться одним логином.
 */
const authLimiters = [
  rateLimiter(WINDOW_15M, 10, (req) => {
    const login = typeof req.body?.login === 'string' ? req.body.login.trim().normalize('NFC').toLocaleLowerCase('ru') : '';
    return login ? `mobile-login:${hashKey(login)}` : '';
  }),
  rateLimiter(WINDOW_15M, 20, (req) => (typeof req.body?.pairing_code === 'string' ? `mobile-pair:${byIp(req)}` : '')),
  rateLimiter(WINDOW_15M, 100, byIp),
];

// ─── Телефон ────────────────────────────────────────────────────────────────

router.post('/auth', ...authLimiters, asyncHandler(async (req: Request, res: Response) => {
  res.json(await authenticateMobile(req.body));
}));

router.get('/config', authenticateDevice, asyncHandler(async (req: Request, res: Response) => {
  res.json(await deviceConfig(req.device!));
}));

router.post('/heartbeat', authenticateDevice, asyncHandler(async (req: Request, res: Response) => {
  res.json(await heartbeat(req.device!, req.body));
}));

router.post('/logs', authenticateDevice, singleFileUpload('file', MAX_LOG_BYTES), asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await receiveLog(req.device!, req.file));
  } finally {
    await removeTempUpload(req);
  }
}));

// ─── CRM: привязка своего телефона ──────────────────────────────────────────

router.post(
  '/pairing-code',
  authenticate,
  rateLimiter(WINDOW_15M, 60, byUserOrIp),
  asyncHandler(async (req: Request, res: Response) => {
    const dto = parseOr400(z.object({ userId: z.string().trim().min(1, 'Выберите сотрудника') }), req.body ?? {});
    res.json(await createPairingCode(req.user!, dto.userId, `${req.protocol}://${req.get('host')}`));
  }),
);

// ─── CRM: админка устройств ─────────────────────────────────────────────────

const admin = [authenticate, authorize('ADMIN', 'SUPER_ADMIN')];

/** Телефоны подключает и обслуживает руководство: админы и РОП. Настройки, Drive и модели — только админы. */
function requirePhonesManager(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user || !canSeeAllCalls(req.user)) {
    next(new AppError(403, 'Доступно руководству'));
    return;
  }
  next();
}
const phones = [authenticate, requirePhonesManager];

router.get('/devices', ...phones, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listDevices());
}));

router.post('/devices/:id/revoke', ...phones, asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { count } = await prisma.mobileDevice.updateMany({
    where: { id, active: true },
    data: { active: false, revokedAt: new Date() },
  });
  if (count === 0) throw new AppError(404, 'Активное устройство не найдено');
  const device = await prisma.mobileDevice.findUnique({ where: { id }, select: { model: true, user: { select: { id: true, fullName: true } } } });
  await auditLog({
    userId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'mobile_device',
    entityId: id,
    after: { event: 'revoked', forUserId: device?.user.id, forUserName: device?.user.fullName, model: device?.model },
  });
  res.json({ ok: true });
}));

router.post('/devices/:id/request-logs', ...phones, asyncHandler(async (req: Request, res: Response) => {
  const { count } = await prisma.mobileDevice.updateMany({ where: { id: String(req.params.id) }, data: { uploadLogsRequested: true } });
  if (count === 0) throw new AppError(404, 'Устройство не найдено');
  res.json({ ok: true });
}));

router.get('/devices/:id/log-url', ...phones, asyncHandler(async (req: Request, res: Response) => {
  const device = await prisma.mobileDevice.findUnique({ where: { id: String(req.params.id) }, select: { lastLogPath: true } });
  if (!device?.lastLogPath) throw new AppError(404, 'Лог ещё не присылали');
  res.json({ url: await signedUrl(device.lastLogPath, 3600) });
}));

router.put('/devices/:id', ...phones, asyncHandler(async (req: Request, res: Response) => {
  const dto = parseOr400(updateDeviceDto, req.body);
  const exists = await prisma.mobileDevice.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
  if (!exists) throw new AppError(404, 'Устройство не найдено');
  await prisma.mobileDevice.update({
    where: { id: String(req.params.id) },
    data: {
      ...(dto.recordingsPathOverride !== undefined ? { recordingsPathOverride: dto.recordingsPathOverride || null } : {}),
      ...(dto.simSlot !== undefined ? { simSlot: dto.simSlot } : {}),
    },
  });
  res.json({ ok: true });
}));

router.get('/device-models', ...admin, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listDeviceModels());
}));

router.put('/device-models', ...admin, asyncHandler(async (req: Request, res: Response) => {
  const dto = parseOr400(deviceModelConfigDto, req.body);
  if (!dto.recordingsPath) {
    await prisma.mobileDeviceModelConfig.deleteMany({ where: { model: dto.model } });
  } else {
    await prisma.mobileDeviceModelConfig.upsert({
      where: { model: dto.model },
      create: { model: dto.model, recordingsPath: dto.recordingsPath },
      update: { recordingsPath: dto.recordingsPath },
    });
  }
  res.json({ ok: true });
}));

// ─── CRM: архив записей на Google Drive ────────────────────────────────────

router.get('/drive', ...admin, asyncHandler(async (req: Request, res: Response) => {
  const [row, archivedCount, pendingCount, failedCount] = await Promise.all([
    getDriveConnection(),
    prisma.callRecording.count({ where: { driveFileId: { not: null } } }),
    prisma.callRecording.count({ where: { driveFileId: null, storagePath: { not: null }, driveAttempts: { lt: 5 } } }),
    prisma.callRecording.count({ where: { driveFileId: null, storagePath: { not: null }, driveAttempts: { gte: 5 } } }),
  ]);
  res.json({
    configured: isDriveConfigured(),
    connected: !!row?.refreshToken,
    accountEmail: row?.accountEmail ?? null,
    connectedAt: row?.connectedAt ?? null,
    lastError: row?.lastError ?? null,
    lastErrorAt: row?.lastErrorAt ?? null,
    redirectUri: driveRedirectUri(`${req.protocol}://${req.get('host')}`),
    folderName: DRIVE_ROOT_FOLDER_NAME,
    archivedCount,
    pendingCount,
    failedCount,
  });
}));

router.get('/drive/auth-url', ...admin, asyncHandler(async (req: Request, res: Response) => {
  res.json({ url: driveAuthUrl(req.user!.userId, `${req.protocol}://${req.get('host')}`) });
}));

/** Сюда Google возвращает браузер после входа. Токена CRM тут нет — кто подключал, знает подписанный state. */
router.get('/drive/callback', asyncHandler(async (req: Request, res: Response) => {
  const back = (status: string, reason?: string) =>
    res.redirect(`${config.telegram.crmUrl}/mobile-devices?drive=${status}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`);
  if (typeof req.query.error === 'string') return back('error', req.query.error === 'access_denied' ? 'Доступ не выдан' : req.query.error);
  try {
    const userId = verifyDriveState(String(req.query.state ?? ''));
    await connectDrive(String(req.query.code ?? ''), userId, `${req.protocol}://${req.get('host')}`);
    // Сразу начинаем копировать то, что накопилось
    archiveRecordings().catch((err) => console.error('[mobile] drive archive failed:', (err as Error).message));
    return back('connected');
  } catch (err) {
    console.error('[mobile] drive connect failed:', (err as Error).message);
    return back('error', err instanceof AppError ? err.message : 'Не удалось подключить Google Drive');
  }
}));

router.post('/drive/disconnect', ...admin, asyncHandler(async (_req: Request, res: Response) => {
  await disconnectDrive();
  res.json({ ok: true });
}));

/** «Скопировать сейчас» — и повторить записи, которые не скопировались за 5 попыток. */
router.post('/drive/sync', ...admin, asyncHandler(async (_req: Request, res: Response) => {
  await prisma.callRecording.updateMany({ where: { driveFileId: null, storagePath: { not: null } }, data: { driveAttempts: 0 } });
  archiveRecordings().catch((err) => console.error('[mobile] drive archive failed:', (err as Error).message));
  res.json({ ok: true });
}));

router.get('/settings', ...admin, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getMobileSettings());
}));

router.put('/settings', ...admin, asyncHandler(async (req: Request, res: Response) => {
  const dto = parseOr400(mobileSettingsDto, req.body);
  const current = await getMobileSettings();
  const start = dto.workStartHour ?? current.workStartHour;
  const end = dto.workEndHour ?? current.workEndHour;
  if (start >= end) throw new AppError(400, 'Начало рабочего дня должно быть раньше конца');
  res.json(await updateMobileSettings({ ...dto, ...(dto.workDays ? { workDays: [...new Set(dto.workDays)].sort() } : {}) }));
}));

export default router;
