import { createHash, randomInt, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { Prisma, type CallSession } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { authService } from '../auth/auth.service';
import { newDeviceToken, hashDeviceToken, type DeviceContext } from './mobile.device-auth';
import { callsBatchDto, mobileAuthDto, mobileCallDto, heartbeatDto, audioFieldsDto, deviceInfoDto, type MobileCallInput } from './mobile.dto';
import { callPhoneKey, mapMobileCall, mobileExternalId } from './mobile.mapping';
import { processNewMobileCall } from './mobile.processing';
import { getMobileSettings } from './mobile.settings';
import { audioExt, audioMime, removeFiles, uploadFile } from './mobile.storage';
import { publicServerUrl } from './mobile.public-url';
import { canSeeAllCalls } from './mobile.access';
import { auditLog } from '../../lib/logger';
import type { z } from 'zod';

// ─── Привязка телефона ──────────────────────────────────────────────────────

const PAIRING_TTL_MS = 10 * 60 * 1000;
/** Без похожих символов (0/O, 1/I/L) — код иногда вводят руками */
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PAIRING_LENGTH = 8;

function hashPairingCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase().replace(/[\s-]/g, '')).digest('hex');
}

/**
 * QR привязки для сотрудника. Телефоны подключает руководство (менеджеры приложением не
 * управляют), поэтому код создаёт руководитель для выбранного сотрудника — и это пишется
 * в журнал действий: кто и для кого.
 */
export async function createPairingCode(actor: { userId: string; role: string; permissions?: string[] }, userId: string, fallbackServer: string) {
  if (!canSeeAllCalls(actor)) throw new AppError(403, 'Подключать телефоны может только руководство');
  const employee = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, isActive: true, role: true } });
  if (!employee) throw new AppError(404, 'Сотрудник не найден');
  if (!employee.isActive) throw new AppError(400, 'Сотрудник деактивирован — подключить телефон нельзя');
  if (employee.role === 'SITE_ADMIN') throw new AppError(400, 'Это аккаунт сайта, а не сотрудник CRM');

  let code = '';
  for (let i = 0; i < PAIRING_LENGTH; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  // Старые неиспользованные коды этого сотрудника больше не нужны
  await prisma.mobilePairingCode.deleteMany({ where: { userId, usedAt: null } });
  const row = await prisma.mobilePairingCode.create({ data: { codeHash: hashPairingCode(code), userId, expiresAt }, select: { id: true } });
  await auditLog({
    userId: actor.userId,
    action: 'CREATE',
    entityType: 'mobile_device',
    entityId: row.id,
    after: { event: 'pairing_code', forUserId: employee.id, forUserName: employee.fullName, expiresAt: expiresAt.toISOString() },
  });
  // Приложение само добавляет к адресу /api/mobile/auth
  const server = publicServerUrl(fallbackServer);
  return {
    code,
    server,
    qr: `callsync://pair?server=${encodeURIComponent(server)}&code=${code}`,
    expiresAt: expiresAt.toISOString(),
    employee: { id: employee.id, name: employee.fullName },
  };
}

type DeviceInfo = z.infer<typeof deviceInfoDto>;

function deviceInfoData(info: DeviceInfo | null | undefined) {
  if (!info) return {};
  return {
    ...(info.model != null ? { model: info.model } : {}),
    ...(info.android_version != null ? { androidVersion: info.android_version } : {}),
    ...(info.sdk_int != null ? { sdkInt: info.sdk_int } : {}),
    ...(info.app_version != null ? { appVersion: info.app_version } : {}),
  };
}

/**
 * Вход с телефона: логин + пароль или одноразовый код из QR. Web-сессию не создаём —
 * телефону выдаётся свой долгоживущий токен. Одно активное устройство на сотрудника:
 * при новом входе старые телефоны этого сотрудника отвязываются.
 */
export async function authenticateMobile(body: unknown) {
  const dto = mobileAuthDto.safeParse(body);
  if (!dto.success) throw new AppError(400, 'Некорректный запрос входа');
  const { login, password, pairing_code: pairingCode, device } = dto.data;

  let userId: string;
  if (pairingCode) {
    const now = new Date();
    const row = await prisma.mobilePairingCode.findUnique({ where: { codeHash: hashPairingCode(pairingCode) } });
    // Одноразовость: помечаем использованным условным апдейтом — второй параллельный вход не пройдёт
    const claimed = row && row.expiresAt > now
      ? await prisma.mobilePairingCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } })
      : { count: 0 };
    if (!row || claimed.count !== 1) throw new AppError(401, 'Код привязки неверный или истёк. Получите новый QR в профиле CRM.');
    userId = row.userId;
  } else {
    if (!login?.trim() || !password) throw new AppError(400, 'Укажите логин и пароль или код привязки');
    const user = await authService.verifyCredentials(login, password, { caseInsensitiveLogin: true });
    userId = user.id;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, isActive: true, role: true } });
  if (!user?.isActive) throw new AppError(401, 'Сотрудник не найден или деактивирован');
  if (user.role === 'SITE_ADMIN') throw new AppError(403, 'Этот аккаунт не относится к CRM');

  const token = newDeviceToken();
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    await tx.mobileDevice.updateMany({
      where: { userId, active: true },
      data: { active: false, revokedAt: now },
    });
    return tx.mobileDevice.create({
      data: { userId, tokenHash: hashDeviceToken(token), lastSeenAt: now, ...deviceInfoData(device) },
      select: { id: true },
    });
  });

  return {
    device_token: token,
    device_id: created.id,
    employee: { id: user.id, name: user.fullName },
  };
}

// ─── Настройки и heartbeat ──────────────────────────────────────────────────

export async function deviceConfig(device: DeviceContext) {
  const settings = await getMobileSettings();
  let recordingsPath = device.recordingsPathOverride?.trim() || null;
  if (!recordingsPath && device.model) {
    const byModel = await prisma.mobileDeviceModelConfig.findUnique({ where: { model: device.model } });
    recordingsPath = byModel?.recordingsPath?.trim() || null;
  }
  return {
    recordings_path: recordingsPath,
    ...(device.simSlot ? { sim_slot: device.simSlot } : {}),
    sync_interval: Math.max(15, settings.syncIntervalMin),
    wifi_only_above_mb: settings.wifiOnlyAboveMb,
  };
}

export async function heartbeat(device: DeviceContext, body: unknown) {
  const parsed = heartbeatDto.safeParse(body ?? {});
  if (!parsed.success) throw new AppError(400, `Некорректный heartbeat: ${parsed.error.issues[0]?.message ?? ''}`);
  const h = parsed.data;
  const now = new Date();
  const updated = await prisma.mobileDevice.update({
    where: { id: device.id },
    data: {
      lastSeenAt: now,
      lastSyncAt: now,
      silentAlertedAt: null,
      ...(h.queue_calls != null ? { queueCalls: h.queue_calls } : {}),
      ...(h.queue_files != null ? { queueFiles: h.queue_files } : {}),
      ...(h.queue_bytes != null ? { queueBytes: h.queue_bytes } : {}),
      ...(h.failed_calls != null ? { failedCalls: h.failed_calls } : {}),
      ...(h.last_call_at ? { lastCallAt: new Date(h.last_call_at) } : {}),
      ...(h.sim_slot != null ? { simSlot: h.sim_slot } : {}),
      ...(h.recordings_dir_found != null ? { recordingsDirFound: h.recordings_dir_found } : {}),
      ...(h.permissions ? { permissions: h.permissions } : {}),
      ...deviceInfoData(h.device),
    },
    select: { uploadLogsRequested: true, model: true, recordingsPathOverride: true, simSlot: true },
  });
  return {
    upload_logs: updated.uploadLogsRequested,
    config: await deviceConfig({ ...device, ...updated }),
  };
}

// ─── Звонки ─────────────────────────────────────────────────────────────────

export type CallResult =
  | { device_call_id: string; status: 'created' | 'duplicate'; call_id: string }
  | { device_call_id: string; status: 'error'; error: string };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function ingestOne(device: DeviceContext, c: MobileCallInput): Promise<{ result: CallResult; session?: CallSession }> {
  const externalCallId = mobileExternalId(device.userId, c.device_call_id);
  const existing = await prisma.callSession.findUnique({ where: { externalCallId }, select: { id: true } });
  if (existing) return { result: { device_call_id: c.device_call_id, status: 'duplicate', call_id: existing.id } };

  const { direction, status } = mapMobileCall(c.direction, c.duration_sec);
  const startedAt = new Date(c.started_at);
  const phone = c.phone?.trim() || null;
  const shownNumber = phone ?? c.phone_raw?.trim() ?? null;
  try {
    const session = await prisma.callSession.create({
      data: {
        provider: 'MOBILE',
        externalCallId,
        direction,
        status,
        fromNumber: direction === 'INBOUND' ? shownNumber : null,
        toNumber: direction === 'OUTBOUND' ? shownNumber : null,
        managerUserId: device.userId,
        startedAt,
        answeredAt: status === 'COMPLETED' ? startedAt : null,
        endedAt: new Date(startedAt.getTime() + c.duration_sec * 1000),
        durationSec: c.duration_sec,
        billSec: status === 'COMPLETED' ? c.duration_sec : 0,
        deviceId: device.id,
        deviceCallId: c.device_call_id,
        phone,
        phoneKey: callPhoneKey(phone) || null,
        mobileType: c.direction,
        simSlot: c.sim_slot ?? null,
        rawEvents: [{ event: 'callsync', at: new Date().toISOString(), payload: c }],
      },
    });
    return { result: { device_call_id: c.device_call_id, status: 'created', call_id: session.id }, session };
  } catch (err) {
    // Тот же звонок пришёл параллельным запросом (повтор после таймаута) — это duplicate, не ошибка
    if (!isUniqueViolation(err)) throw err;
    const row = await prisma.callSession.findUnique({ where: { externalCallId }, select: { id: true } });
    if (!row) throw err;
    return { result: { device_call_id: c.device_call_id, status: 'duplicate', call_id: row.id } };
  }
}

/**
 * Пакет событий до 100 штук. Каждый элемент проверяется отдельно: невалидный получает
 * status "error", остальные записываются. Повтор — "duplicate" с тем же call_id.
 */
export async function ingestCalls(device: DeviceContext, body: unknown): Promise<{ results: CallResult[] }> {
  const envelope = callsBatchDto.safeParse(body);
  if (!envelope.success) {
    throw new AppError(400, envelope.error.issues[0]?.message ?? 'Ожидается { "calls": [...] }');
  }

  const results: CallResult[] = new Array(envelope.data.calls.length);
  const valid: { index: number; call: MobileCallInput }[] = [];
  envelope.data.calls.forEach((raw, index) => {
    const parsed = mobileCallDto.safeParse(raw);
    if (parsed.success) {
      valid.push({ index, call: parsed.data });
    } else {
      const id = raw && typeof raw === 'object' && typeof (raw as { device_call_id?: unknown }).device_call_id === 'string'
        ? (raw as { device_call_id: string }).device_call_id
        : '';
      results[index] = { device_call_id: id, status: 'error', error: parsed.error.issues[0]?.message ?? 'invalid call' };
    }
  });

  // По времени звонка: тогда «пропущенный → перезвонил» в одной пачке обрабатывается по порядку
  valid.sort((a, b) => a.call.started_at.localeCompare(b.call.started_at));
  const created: CallSession[] = [];
  for (const { index, call } of valid) {
    const { result, session } = await ingestOne(device, call);
    results[index] = result;
    if (session) created.push(session);
  }

  for (const session of created) {
    try {
      await processNewMobileCall(session);
    } catch (err) {
      console.error(`[mobile] processing call ${session.id} failed:`, (err as Error).message);
    }
  }

  if (created.length > 0) {
    const last = created.reduce((a, b) => (a.startedAt > b.startedAt ? a : b)).startedAt;
    await prisma.mobileDevice.updateMany({
      where: { id: device.id, OR: [{ lastCallAt: null }, { lastCallAt: { lt: last } }] },
      data: { lastCallAt: last },
    });
  }

  return { results };
}

// ─── Записи разговоров ──────────────────────────────────────────────────────

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

async function sha256OfFile(localPath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(localPath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}

function storagePathFor(userId: string, at: Date, ext: string): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${userId}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

/** Ставим ли запись звонка в очередь на транскрибацию и аудит. */
async function audioStatusFor(session: Pick<CallSession, 'durationSec'>): Promise<{ audioStatus: 'UPLOADED' | 'SKIPPED'; audioError: string | null }> {
  const settings = await getMobileSettings();
  // Постоянный анализ выключен — запись ждёт ручного запуска (кнопка «Проанализировать»)
  if (!settings.autoAuditEnabled) return { audioStatus: 'SKIPPED', audioError: 'Анализ не запускали' };
  if ((session.durationSec ?? 0) < settings.minAuditDurationSec) {
    return { audioStatus: 'SKIPPED', audioError: `Звонок короче ${settings.minAuditDurationSec} с — не анализируем автоматически` };
  }
  return { audioStatus: 'UPLOADED', audioError: null };
}

async function attachRecordingToCall(session: Pick<CallSession, 'id' | 'durationSec'>, storagePath: string | null) {
  await prisma.callSession.update({
    where: { id: session.id },
    data: { recordingPath: storagePath, audioAttempts: 0, ...(await audioStatusFor(session)) },
  });
}

export interface UploadedAudio {
  path: string;
  originalname: string;
  size: number;
}

/**
 * Запись разговора. Идемпотентность — по SHA-256 файла: повтор после таймаута отдаёт
 * duplicate и второй файл не создаёт. `callId` null — запись, не сопоставленная со звонком.
 */
export async function receiveAudio(
  device: DeviceContext,
  file: UploadedAudio | undefined,
  rawFields: unknown,
  headerSha: string | undefined,
  callId: string | null,
) {
  if (!file) throw new AppError(400, 'Файл не передан (часть file)');
  const fields = audioFieldsDto.safeParse(rawFields ?? {});
  if (!fields.success) throw new AppError(400, `Некорректные поля: ${fields.error.issues[0]?.message ?? ''}`);

  const sha = await sha256OfFile(file.path);
  const claimed = headerSha?.trim().toLowerCase();
  if (claimed && claimed !== sha) throw new AppError(400, 'X-Audio-SHA256 не совпадает с содержимым файла');

  const session = callId
    ? await prisma.callSession.findFirst({
      // Чей телефон — по externalCallId: менеджера у звонка руководитель мог сменить
      where: { id: callId, provider: 'MOBILE', deletedAt: null, externalCallId: { startsWith: `mobile:${device.userId}:` } },
      select: { id: true, durationSec: true, startedAt: true },
    })
    : null;
  if (callId && !session) throw new AppError(404, 'Звонок не найден');

  const existing = await prisma.callRecording.findUnique({ where: { sha256: sha } });
  if (existing) {
    // Файл раньше пришёл как несопоставленный, а теперь приложение нашло его звонок
    if (session && !existing.callSessionId && existing.userId === device.userId) {
      await prisma.callRecording.update({ where: { id: existing.id }, data: { callSessionId: session.id } });
      await attachRecordingToCall(session, existing.storagePath);
    }
    return { status: 200, body: { status: 'duplicate', audio_id: existing.id, duration: existing.durationSec ?? 0 } };
  }

  const ext = audioExt(file.originalname);
  const mime = audioMime(ext);
  const storagePath = storagePathFor(device.userId, session?.startedAt ?? new Date(), ext);
  await uploadFile(storagePath, file.path, mime);

  const durationSec = fields.data.duration_sec != null ? Math.round(fields.data.duration_sec) : null;
  let recording;
  try {
    recording = await prisma.callRecording.create({
      data: {
        sha256: sha,
        callSessionId: session?.id ?? null,
        userId: device.userId,
        deviceId: device.id,
        storagePath,
        fileName: (fields.data.file_name || file.originalname).slice(0, 500),
        mimeType: mime,
        sizeBytes: file.size,
        durationSec: durationSec || null,
        fileModifiedAt: fields.data.file_modified_at ? new Date(fields.data.file_modified_at) : null,
      },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Параллельная загрузка того же файла успела раньше — наш экземпляр лишний
    await removeFiles([storagePath]).catch(() => {});
    const row = await prisma.callRecording.findUnique({ where: { sha256: sha } });
    if (!row) throw err;
    return { status: 200, body: { status: 'duplicate', audio_id: row.id, duration: row.durationSec ?? 0 } };
  }

  if (session) await attachRecordingToCall(session, storagePath);
  // Записи снова приходят — эпизод «перестали подхватываться записи» закончился
  await prisma.mobileDevice.updateMany({ where: { userId: device.userId, active: true }, data: { noRecordingsAlertedAt: null } });

  return {
    status: 201,
    body: {
      status: 'created',
      audio_id: recording.id,
      audio_url: session ? `${config.telegram.crmUrl}/calls?call=${session.id}` : null,
      duration: durationSec ?? session?.durationSec ?? 0,
    },
  };
}

// ─── Лог приложения ─────────────────────────────────────────────────────────

export const MAX_LOG_BYTES = 5 * 1024 * 1024;

export async function receiveLog(device: DeviceContext, file: UploadedAudio | undefined) {
  if (!file) throw new AppError(400, 'Файл не передан (часть file)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const storagePath = `logs/${device.userId}/${device.id}/${stamp}.txt`;
  await uploadFile(storagePath, file.path, 'text/plain; charset=utf-8');
  await prisma.mobileDevice.update({
    where: { id: device.id },
    data: { lastLogPath: storagePath, lastLogAt: new Date(), uploadLogsRequested: false },
  });
  return { ok: true };
}
