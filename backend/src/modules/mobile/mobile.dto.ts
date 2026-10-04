import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { MOBILE_CALL_TYPES } from './mobile.mapping';

// ─── Телефон (контракт CallSync, поля в snake_case менять нельзя) ───────────

export const deviceInfoDto = z.object({
  model: z.string().trim().max(120).nullish(),
  android_version: z.string().trim().max(40).nullish(),
  sdk_int: z.number().int().min(0).max(1000).nullish(),
  app_version: z.string().trim().max(40).nullish(),
}).partial();

export const mobileAuthDto = z.object({
  login: z.string().max(200).optional(),
  password: z.string().max(200).optional(),
  pairing_code: z.string().trim().max(32).optional(),
  device: deviceInfoDto.optional(),
});

export const mobileCallDto = z.object({
  device_call_id: z.string().trim().min(1, 'device_call_id is required').max(128),
  phone: z.string().trim().max(32).nullish(),
  phone_raw: z.string().max(64).nullish(),
  direction: z.enum(MOBILE_CALL_TYPES, { errorMap: () => ({ message: 'invalid direction' }) }),
  started_at: z.string().datetime({ offset: true, message: 'invalid started_at' }),
  duration_sec: z.number({ message: 'invalid duration_sec' }).int('invalid duration_sec').min(0, 'invalid duration_sec').max(24 * 3600, 'invalid duration_sec'),
  sim_slot: z.number().int().min(1).max(8).nullish(),
});
export type MobileCallInput = z.infer<typeof mobileCallDto>;

export const MAX_CALLS_PER_BATCH = 100;

export const callsBatchDto = z.object({
  calls: z.array(z.unknown()).max(MAX_CALLS_PER_BATCH, `Не больше ${MAX_CALLS_PER_BATCH} событий за запрос`),
});

export const heartbeatDto = z.object({
  queue_calls: z.number().int().min(0).nullish(),
  queue_files: z.number().int().min(0).nullish(),
  queue_bytes: z.number().min(0).nullish(),
  failed_calls: z.number().int().min(0).nullish(),
  last_call_at: z.string().datetime({ offset: true }).nullish(),
  last_success_at: z.string().datetime({ offset: true }).nullish(),
  sim_slot: z.number().int().min(1).max(8).nullish(),
  recordings_dir_found: z.boolean().nullish(),
  permissions: z.record(z.string().max(64), z.boolean()).nullish(),
  device: deviceInfoDto.nullish(),
}).partial();

/** Поля multipart-запроса с записью (кроме самого файла). */
export const audioFieldsDto = z.object({
  file_name: z.string().max(500).optional(),
  duration_sec: z.coerce.number().min(0).max(24 * 3600).optional(),
  file_modified_at: z.string().datetime({ offset: true }).optional(),
});

// ─── CRM ────────────────────────────────────────────────────────────────────

const boolQuery = z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean());
const dateQuery = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Дата в формате YYYY-MM-DD');

export const listCallsQuery = z.object({
  from: dateQuery.optional(),
  to: dateQuery.optional(),
  managerId: z.string().trim().min(1).optional(),
  /** Направление из приложения, можно несколько через запятую */
  type: z.string().trim().optional(),
  missedOnly: boolQuery.optional(),
  withRecording: boolQuery.optional(),
  unknownOnly: boolQuery.optional(),
  clientId: z.string().trim().min(1).optional(),
  /** Поиск по цифрам номера */
  phone: z.string().trim().max(32).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListCallsQuery = z.infer<typeof listCallsQuery>;

export const linkClientDto = z.object({
  clientId: z.string().trim().min(1, 'Выберите клиента'),
  /** Записать номер в карточку клиента, если там пусто */
  savePhone: z.boolean().optional(),
});

export const callbackTaskDto = z.object({
  dueAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(2000).optional(),
}).optional();

export const updateDeviceDto = z.object({
  recordingsPathOverride: z.string().trim().max(500).nullable().optional(),
  simSlot: z.number().int().min(1).max(8).nullable().optional(),
});

export const deviceModelConfigDto = z.object({
  model: z.string().trim().min(1).max(120),
  /** Пустая строка — убрать настройку для модели */
  recordingsPath: z.string().trim().max(500),
});

export const mobileSettingsDto = z.object({
  workStartHour: z.number().int().min(0).max(23),
  workEndHour: z.number().int().min(1).max(24),
  workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  wifiOnlyAboveMb: z.number().int().min(0).max(1000),
  syncIntervalMin: z.number().int().min(15).max(24 * 60),
  minAuditDurationSec: z.number().int().min(0).max(3600),
  autoAuditEnabled: z.boolean(),
  recordingsBufferDays: z.number().int().min(1).max(365),
  driveRetentionMonths: z.number().int().min(0).max(120),
}).partial().refine(
  (v) => v.workStartHour === undefined || v.workEndHour === undefined || v.workStartHour < v.workEndHour,
  { message: 'Начало рабочего дня должно быть раньше конца' },
);

/** Разбор тела запроса: ошибка валидации — 400 с понятным {message}, а не 500. */
export function parseOr400<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new AppError(400, `${where}${issue?.message ?? 'некорректные данные'}`);
  }
  return parsed.data;
}
