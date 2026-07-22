import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { telegramService } from '../telegram/telegram.service';
import { fetchDashboardList, TimePayAuthError, TimePayApiError, type TimePayDashboardEntry } from './timepay.client';

/** Компания работает в Ташкенте (UTC+5, без перехода на летнее время) — тот же принцип, что в attendance.service.ts. */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Не слать повторный алерт админам об истёкшем токене чаще, чем раз в это время. */
const TOKEN_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function tashkentTodayYmd(): string {
  const t = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** date-only для @db.Date — без смещения, иначе календарная дата съедет на день (см. attendance.service.ts). */
function ymdToDateOnly(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * TimePay может отдавать время как ISO со смещением ("...+05:00" / "...Z") — тогда парсим как есть,
 * либо как "наивную" строку без зоны ("YYYY-MM-DD HH:mm[:ss]") — тогда считаем её локальным
 * временем Ташкента и сами вычитаем смещение, чтобы получить правильный UTC-инстант.
 */
function parseTimePayDateTime(raw: unknown, fallbackYmd: string): Date | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const full = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(str);
  if (full) {
    const [, y, mo, d, h, mi, s] = full;
    return new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0)) - TASHKENT_OFFSET_MS,
    );
  }

  // Только время ("09:05" / "09:05:00") — на дату записи, переданную вызывающим.
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str);
  if (timeOnly) {
    const [y, mo, d] = fallbackYmd.split('-').map(Number);
    const [, h, mi, s] = timeOnly;
    return new Date(
      Date.UTC(y, mo - 1, d, Number(h), Number(mi), Number(s || 0)) - TASHKENT_OFFSET_MS,
    );
  }

  return null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

const NAME_FIELD_CANDIDATES = ['full_name', 'fullname', 'fio', 'name', 'employee_name'];
const CHECK_IN_FIELD_CANDIDATES = ['check_in', 'checkin', 'checkin_time', 'first_in', 'come_time', 'entry_time', 'arrived_at', 'in_time'];
const CHECK_OUT_FIELD_CANDIDATES = ['check_out', 'checkout', 'checkout_time', 'last_out', 'leave_time', 'exit_time', 'left_at', 'out_time'];

function pickField(entry: TimePayDashboardEntry, candidates: string[]): unknown {
  for (const key of candidates) {
    if (entry[key] != null && entry[key] !== '') return entry[key];
  }
  return undefined;
}

function extractEmployeeName(entry: TimePayDashboardEntry): string | null {
  const direct = pickField(entry, NAME_FIELD_CANDIDATES);
  if (typeof direct === 'string' && direct.trim()) return direct;

  const nested = entry.employee;
  if (nested && typeof nested === 'object') {
    const nestedName = pickField(nested as TimePayDashboardEntry, NAME_FIELD_CANDIDATES);
    if (typeof nestedName === 'string' && nestedName.trim()) return nestedName;
    const first = (nested as Record<string, unknown>).first_name;
    const last = (nested as Record<string, unknown>).last_name;
    if (typeof first === 'string' || typeof last === 'string') {
      return [first, last].filter(Boolean).join(' ').trim() || null;
    }
  }
  return null;
}

async function getIntegration() {
  return prisma.timePayIntegration.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
}

export async function getTimePayStatus() {
  const row = await getIntegration();
  return {
    hasToken: !!row.accessToken,
    tokenPreview: row.accessToken ? `…${row.accessToken.slice(-6)}` : null,
    tokenUpdatedAt: row.tokenUpdatedAt,
    lastSyncAt: row.lastSyncAt,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncError: row.lastSyncError,
    lastSyncMatched: row.lastSyncMatched,
    lastSyncUnmatched: row.lastSyncUnmatched,
  };
}

export async function setTimePayToken(accessToken: string, updatedById: string) {
  await prisma.timePayIntegration.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      accessToken,
      tokenUpdatedAt: new Date(),
      tokenUpdatedById: updatedById,
      lastSyncStatus: null,
      lastSyncError: null,
      lastTokenAlertAt: null,
    },
    update: {
      accessToken,
      tokenUpdatedAt: new Date(),
      tokenUpdatedById: updatedById,
      lastSyncStatus: null,
      lastSyncError: null,
      lastTokenAlertAt: null,
    },
  });
  return getTimePayStatus();
}

async function alertAdminsTokenExpired() {
  const row = await getIntegration();
  const now = Date.now();
  if (row.lastTokenAlertAt && now - row.lastTokenAlertAt.getTime() < TOKEN_ALERT_COOLDOWN_MS) return;

  await prisma.timePayIntegration.update({
    where: { id: 'singleton' },
    data: { lastTokenAlertAt: new Date() },
  });

  telegramService
    .sendToRoles(['SUPER_ADMIN', 'ADMIN'], {
      title: 'TimePay: токен истёк',
      body: 'Синхронизация посещаемости с TimePay остановлена — обновите токен в Настройках компании.',
      url: '/settings/company',
      severity: 'WARNING',
    })
    .catch(() => {});
}

export interface SyncResult {
  status: 'SUCCESS' | 'NOT_CONFIGURED' | 'AUTH_ERROR' | 'ERROR';
  matched: number;
  unmatched: number;
  unmatchedNames: string[];
  error?: string;
}

export async function syncAttendanceFromTimePay(dateYmd: string = tashkentTodayYmd()): Promise<SyncResult> {
  const integration = await getIntegration();
  if (!integration.accessToken) {
    return { status: 'NOT_CONFIGURED', matched: 0, unmatched: 0, unmatchedNames: [] };
  }

  let entries: TimePayDashboardEntry[];
  try {
    entries = await fetchDashboardList(integration.accessToken, { date: dateYmd });
  } catch (err) {
    if (err instanceof TimePayAuthError) {
      await prisma.timePayIntegration.update({
        where: { id: 'singleton' },
        data: { lastSyncAt: new Date(), lastSyncStatus: 'ERROR', lastSyncError: err.message },
      });
      await alertAdminsTokenExpired();
      return { status: 'AUTH_ERROR', matched: 0, unmatched: 0, unmatchedNames: [], error: err.message };
    }
    const msg = err instanceof TimePayApiError ? err.message : String(err);
    await prisma.timePayIntegration.update({
      where: { id: 'singleton' },
      data: { lastSyncAt: new Date(), lastSyncStatus: 'ERROR', lastSyncError: msg },
    });
    return { status: 'ERROR', matched: 0, unmatched: 0, unmatchedNames: [], error: msg };
  }

  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true } });
  const userByName = new Map(users.map((u) => [normalizeName(u.fullName), u.id]));

  const dateOnly = ymdToDateOnly(dateYmd);
  let matched = 0;
  const unmatchedNames: string[] = [];

  for (const entry of entries) {
    const name = extractEmployeeName(entry);
    if (!name) {
      console.warn('[timepay] entry without a recognizable name field, sample:', JSON.stringify(entry).slice(0, 300));
      continue;
    }

    const userId = userByName.get(normalizeName(name));
    if (!userId) {
      unmatchedNames.push(name);
      continue;
    }

    const checkIn = parseTimePayDateTime(pickField(entry, CHECK_IN_FIELD_CANDIDATES), dateYmd);
    const checkOut = parseTimePayDateTime(pickField(entry, CHECK_OUT_FIELD_CANDIDATES), dateYmd);
    if (!checkIn && !checkOut) continue;

    await prisma.attendanceRecord.upsert({
      where: { userId_date: { userId, date: dateOnly } },
      create: { userId, date: dateOnly, checkIn, checkOut },
      update: { checkIn, checkOut },
    });
    matched += 1;
  }

  await prisma.timePayIntegration.update({
    where: { id: 'singleton' },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: 'SUCCESS',
      lastSyncError: null,
      lastSyncMatched: matched,
      lastSyncUnmatched: unmatchedNames.length,
    },
  });

  if (unmatchedNames.length) {
    console.warn(`[timepay] ${unmatchedNames.length} employee(s) not matched by full name:`, unmatchedNames.slice(0, 10));
  }

  return { status: 'SUCCESS', matched, unmatched: unmatchedNames.length, unmatchedNames };
}

export { tashkentTodayYmd };

export function assertYmd(value: string | undefined): string {
  if (!value) return tashkentTodayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'Некорректная дата (ожидается YYYY-MM-DD)');
  }
  return value;
}
