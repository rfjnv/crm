import { Router, Request, Response } from 'express';
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
  rateLimiter(WINDOW_15M, 20, byUserOrIp),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await createPairingCode(req.user!.userId, `${req.protocol}://${req.get('host')}`));
  }),
);

// ─── CRM: админка устройств ─────────────────────────────────────────────────

const admin = [authenticate, authorize('ADMIN', 'SUPER_ADMIN')];

router.get('/devices', ...admin, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listDevices());
}));

router.post('/devices/:id/revoke', ...admin, asyncHandler(async (req: Request, res: Response) => {
  const { count } = await prisma.mobileDevice.updateMany({
    where: { id: String(req.params.id), active: true },
    data: { active: false, revokedAt: new Date() },
  });
  if (count === 0) throw new AppError(404, 'Активное устройство не найдено');
  res.json({ ok: true });
}));

router.post('/devices/:id/request-logs', ...admin, asyncHandler(async (req: Request, res: Response) => {
  const { count } = await prisma.mobileDevice.updateMany({ where: { id: String(req.params.id) }, data: { uploadLogsRequested: true } });
  if (count === 0) throw new AppError(404, 'Устройство не найдено');
  res.json({ ok: true });
}));

router.get('/devices/:id/log-url', ...admin, asyncHandler(async (req: Request, res: Response) => {
  const device = await prisma.mobileDevice.findUnique({ where: { id: String(req.params.id) }, select: { lastLogPath: true } });
  if (!device?.lastLogPath) throw new AppError(404, 'Лог ещё не присылали');
  res.json({ url: await signedUrl(device.lastLogPath, 3600) });
}));

router.put('/devices/:id', ...admin, asyncHandler(async (req: Request, res: Response) => {
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
