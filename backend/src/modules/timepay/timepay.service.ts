import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { telegramService } from '../telegram/telegram.service';
import { fetchDashboardList, TimePayAuthError, TimePayApiError, type TimePayDashboardEntry } from './timepay.client';
import { createNameMatcher } from './timepay.matching';

/** Компания работает в Ташкенте (UTC+5, без перехода на летнее время) — тот же принцип, что в attendance.service.ts. */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Сколько последних дней пересинхронизировать после старта сервера и после смены токена. */
export const BACKFILL_DAYS = 14;

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

/**
 * Сопоставление записи TimePay с пользователем CRM: сначала по сохранённому ID TimePay,
 * затем по ФИО (без учёта регистра, ё/е, порядка слов, отчества и латиницы — см. timepay.matching).
 *
 * ID-привязка — осознанное решение админа, применяем её вне зависимости от isActive
 * (некоторые роли вроде водителей/грузчиков могут быть без доступа в CRM, но физически работают).
 * Фоллбэк по ФИО — только для активных и только при единственном кандидате. Найденный по ФИО
 * ID TimePay сохраняется пользователю (если у него ID ещё нет и этот ID ни за кем не закреплён):
 * дальше он сопоставляется надёжно по ID, а «Посещаемость» знает, что его отмечает TimePay.
 */
async function buildEmployeeResolver() {
  const [activeUsers, mappedUsers] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, timepayEmployeeId: true } }),
    prisma.user.findMany({ where: { timepayEmployeeId: { not: null } }, select: { id: true, timepayEmployeeId: true } }),
  ]);
  const userByTimepayId = new Map(mappedUsers.map((u) => [u.timepayEmployeeId as string, u.id]));
  const usersWithoutId = new Set(activeUsers.filter((u) => !u.timepayEmployeeId).map((u) => u.id));
  const matchName = createNameMatcher(activeUsers);

  const resolve = async (timepayId: string | null, name: string | null): Promise<{ userId: string; byId: boolean } | null> => {
    const byId = timepayId ? userByTimepayId.get(timepayId) : undefined;
    if (byId) return { userId: byId, byId: true };
    if (!name) return null;
    const userId = matchName(name);
    if (!userId) return null;
    if (timepayId && usersWithoutId.has(userId) && !userByTimepayId.has(timepayId)) {
      await prisma.user.update({ where: { id: userId }, data: { timepayEmployeeId: timepayId } });
      userByTimepayId.set(timepayId, userId);
      usersWithoutId.delete(userId);
    }
    return { userId, byId: false };
  };

  return { resolve, activeUsers };
}

/**
 * Записи дашборда только по выбранным филиалам. TimePay фильтрует по названию филиала
 * (branch=Polygraph), не по его id; пустой список филиалов — все сотрудники.
 */
async function fetchBranchEntries(accessToken: string, date: string, branches: string[]): Promise<TimePayDashboardEntry[]> {
  if (!branches.length) return fetchDashboardList(accessToken, { date });
  const byId = new Map<string, TimePayDashboardEntry>();
  const withoutId: TimePayDashboardEntry[] = [];
  for (const branch of branches) {
    for (const entry of await fetchDashboardList(accessToken, { date, branch })) {
      const id = extractEmployeeId(entry);
      if (id) byId.set(id, entry);
      else withoutId.push(entry);
    }
  }
  return [...byId.values(), ...withoutId];
}

export interface TimePayEmployeeRow {
  timepayId: string;
  name: string;
  /** Пользователь CRM, к которому привязан этот ID TimePay. */
  boundUser: { id: string; fullName: string } | null;
  /** Пользователь CRM, похожий по ФИО (если такой один) — подставляется в выбор по умолчанию. */
  suggestedUserId: string | null;
}

/**
 * Все сотрудники TimePay выбранных филиалов — для привязки и скрытия в настройках —
 * и отдельно скрытые. Здесь только смотрим: без автопривязки, чтобы просмотр ничего не записывал.
 */
export async function listTimePayEmployees(dateYmd: string = tashkentTodayYmd()) {
  const integration = await getIntegration();
  if (!integration.accessToken) return { status: 'NOT_CONFIGURED' as const, employees: [], hidden: [] };
  const hiddenIds = new Set(integration.hiddenEmployeeIds);
  const [entries, allEntries] = await Promise.all([
    fetchBranchEntries(integration.accessToken, dateYmd, integration.branches),
    hiddenIds.size ? fetchDashboardList(integration.accessToken, { date: dateYmd }) : Promise.resolve([]),
  ]);

  const [activeUsers, mappedUsers] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true } }),
    prisma.user.findMany({ where: { timepayEmployeeId: { not: null } }, select: { id: true, fullName: true, timepayEmployeeId: true } }),
  ]);
  const boundById = new Map(mappedUsers.map((u) => [u.timepayEmployeeId as string, { id: u.id, fullName: u.fullName }]));
  const matchName = createNameMatcher(activeUsers);

  const employees: TimePayEmployeeRow[] = [];
  for (const entry of entries) {
    const timepayId = extractEmployeeId(entry);
    if (!timepayId || hiddenIds.has(timepayId)) continue;
    const name = extractEmployeeName(entry);
    const boundUser = boundById.get(timepayId) ?? null;
    employees.push({
      timepayId,
      name: name ?? `ID ${timepayId}`,
      boundUser,
      suggestedUserId: !boundUser && name ? matchName(name) : null,
    });
  }
  employees.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const nameById = new Map(allEntries.map((e) => [extractEmployeeId(e), extractEmployeeName(e)]));
  const hidden = integration.hiddenEmployeeIds
    .map((timepayId) => ({ timepayId, name: nameById.get(timepayId) ?? `ID ${timepayId}` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return { status: 'SUCCESS' as const, employees, hidden };
}

export async function updateTimePaySettings(data: { branches?: string[]; hiddenEmployeeIds?: string[] }) {
  await getIntegration();
  await prisma.timePayIntegration.update({
    where: { id: 'singleton' },
    data: {
      ...(data.branches && { branches: [...new Set(data.branches.map((b) => b.trim()).filter(Boolean))] }),
      ...(data.hiddenEmployeeIds && { hiddenEmployeeIds: [...new Set(data.hiddenEmployeeIds)] }),
    },
  });
  return getTimePayStatus();
}

const NAME_FIELD_CANDIDATES = ['full_name', 'fullname', 'fio', 'name', 'employee_name'];
const CHECK_IN_FIELD_CANDIDATES = ['check_in', 'checkin', 'checkin_time', 'first_in', 'come_time', 'entry_time', 'arrived_at', 'in_time'];
const CHECK_OUT_FIELD_CANDIDATES = ['check_out', 'checkout', 'checkout_time', 'last_out', 'leave_time', 'exit_time', 'left_at', 'out_time'];
/**
 * ID сотрудника. У /terminals/v6/dashboard/list/ структура плоская — записи не привязка "смена
 * сотрудника" со своим id, а сам сотрудник за день, и его TimePay id лежит прямо в "id"
 * (подтверждено реальным ответом: {"id": 7397, "full_name": "...", "check_in": ..., ...}).
 */
const EMPLOYEE_ID_FIELD_CANDIDATES = ['employee_id', 'employeeid', 'emp_id', 'staff_id', 'id'];

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

/** ID сотрудника в TimePay для этой записи дашборда — приоритетный способ сопоставления (см. User.timepayEmployeeId). */
function extractEmployeeId(entry: TimePayDashboardEntry): string | null {
  const direct = pickField(entry, EMPLOYEE_ID_FIELD_CANDIDATES);
  if (direct != null) return String(direct);

  const nested = entry.employee;
  if (nested && typeof nested === 'object') {
    const nestedId = (nested as Record<string, unknown>).id;
    if (nestedId != null) return String(nestedId);
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
    lastSyncSample: row.lastSyncSample,
    branches: row.branches,
    hiddenCount: row.hiddenEmployeeIds.length,
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
  // Пока токен был просрочен, дни не синкались — догоняем их в фоне.
  syncRecentDays(BACKFILL_DAYS).catch((err) => console.error('[timepay] backfill after token update failed:', err));
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

/** Ночная смена длиннее этого не бывает — дальше уход без прихода к вчерашнему дню не относим. */
const MAX_NIGHT_SHIFT_MS = 16 * 60 * 60 * 1000;

/**
 * Уход без прихода в записи дня D: если вчера человек пришёл и ещё не ушёл (или ушёл раньше),
 * а этот уход укладывается в одну смену от вчерашнего прихода — это уход вчерашней смены.
 * Пустую запись дня D, созданную из этого хвоста раньше, убираем.
 */
async function attachToPreviousNight(userId: string, dateOnly: Date, checkOut: Date): Promise<boolean> {
  const prevDate = new Date(dateOnly.getTime() - DAY_MS);
  const prev = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date: prevDate } } });
  if (!prev?.checkIn) return false;
  if (checkOut <= prev.checkIn || checkOut.getTime() - prev.checkIn.getTime() > MAX_NIGHT_SHIFT_MS) return false;

  if (!prev.checkOut || prev.checkOut < checkOut) {
    await prisma.attendanceRecord.update({ where: { id: prev.id }, data: { checkOut } });
  }
  await prisma.attendanceRecord.deleteMany({
    where: { userId, date: dateOnly, checkIn: null, checkOut, marks: { isEmpty: true }, note: null },
  });
  return true;
}

export interface SyncResult {
  status: 'SUCCESS' | 'NOT_CONFIGURED' | 'AUTH_ERROR' | 'ERROR';
  matched: number;
  matchedById: number;
  matchedByName: number;
  unmatched: number;
  unmatchedNames: string[];
  error?: string;
  /** Сырой JSON первой записи дашборда TimePay — чтобы свериться с реальными названиями полей. */
  sampleEntry?: string | null;
}

export async function syncAttendanceFromTimePay(dateYmd: string = tashkentTodayYmd()): Promise<SyncResult> {
  const integration = await getIntegration();
  if (!integration.accessToken) {
    return { status: 'NOT_CONFIGURED', matched: 0, matchedById: 0, matchedByName: 0, unmatched: 0, unmatchedNames: [] };
  }

  let entries: TimePayDashboardEntry[];
  try {
    const hiddenIds = new Set(integration.hiddenEmployeeIds);
    entries = (await fetchBranchEntries(integration.accessToken, dateYmd, integration.branches)).filter(
      (entry) => !hiddenIds.has(extractEmployeeId(entry) ?? ''),
    );
  } catch (err) {
    if (err instanceof TimePayAuthError) {
      await prisma.timePayIntegration.update({
        where: { id: 'singleton' },
        data: { lastSyncAt: new Date(), lastSyncStatus: 'ERROR', lastSyncError: err.message },
      });
      await alertAdminsTokenExpired();
      return { status: 'AUTH_ERROR', matched: 0, matchedById: 0, matchedByName: 0, unmatched: 0, unmatchedNames: [], error: err.message };
    }
    const msg = err instanceof TimePayApiError ? err.message : String(err);
    await prisma.timePayIntegration.update({
      where: { id: 'singleton' },
      data: { lastSyncAt: new Date(), lastSyncStatus: 'ERROR', lastSyncError: msg },
    });
    return { status: 'ERROR', matched: 0, matchedById: 0, matchedByName: 0, unmatched: 0, unmatchedNames: [], error: msg };
  }

  const sampleEntry = entries.length ? JSON.stringify(entries[0], null, 2).slice(0, 4000) : null;

  const { resolve } = await buildEmployeeResolver();

  const dateOnly = ymdToDateOnly(dateYmd);
  let matchedById = 0;
  let matchedByName = 0;
  const unmatchedNames: string[] = [];

  for (const entry of entries) {
    const timepayId = extractEmployeeId(entry);
    const name = extractEmployeeName(entry);

    const resolved = await resolve(timepayId, name);
    const userId = resolved?.userId;
    const byId = resolved?.byId ?? false;

    if (!userId) {
      if (name) unmatchedNames.push(name);
      else console.warn('[timepay] entry without a recognizable id/name field, sample:', JSON.stringify(entry).slice(0, 300));
      continue;
    }

    const checkIn = parseTimePayDateTime(pickField(entry, CHECK_IN_FIELD_CANDIDATES), dateYmd);
    let checkOut = parseTimePayDateTime(pickField(entry, CHECK_OUT_FIELD_CANDIDATES), dateYmd);
    if (!checkIn && !checkOut) continue;

    // Ночная смена: TimePay отдаёт только время, и уход после полуночи ("02:11") — это уже следующие сутки.
    if (checkIn && checkOut && checkOut <= checkIn) checkOut = new Date(checkOut.getTime() + DAY_MS);

    // Уход без прихода — обычно хвост вчерашней ночной смены: TimePay иногда кладёт его на следующий день.
    if (!checkIn && checkOut && (await attachToPreviousNight(userId, dateOnly, checkOut))) {
      if (byId) matchedById += 1;
      else matchedByName += 1;
      continue;
    }

    // null не затирает уже известное время: уход ночной смены мог прийти из записи следующего дня.
    await prisma.attendanceRecord.upsert({
      where: { userId_date: { userId, date: dateOnly } },
      create: { userId, date: dateOnly, checkIn, checkOut },
      update: { checkIn: checkIn ?? undefined, checkOut: checkOut ?? undefined },
    });
    if (byId) matchedById += 1;
    else matchedByName += 1;
  }

  const matched = matchedById + matchedByName;

  await prisma.timePayIntegration.update({
    where: { id: 'singleton' },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: 'SUCCESS',
      lastSyncError: null,
      lastSyncMatched: matched,
      lastSyncUnmatched: unmatchedNames.length,
      lastSyncSample: sampleEntry,
    },
  });

  if (unmatchedNames.length) {
    console.warn(`[timepay] ${unmatchedNames.length} employee(s) not matched by id or full name:`, unmatchedNames.slice(0, 10));
  }

  return { status: 'SUCCESS', matched, matchedById, matchedByName, unmatched: unmatchedNames.length, unmatchedNames, sampleEntry };
}

/**
 * Синк последних N дней по порядку, от старого к сегодняшнему: уход ночной смены появляется
 * в TimePay уже после полуночи (в записи вчера или сегодня), поэтому один «сегодня» его теряет.
 * Возвращает результат за сегодня; на ошибке токена дальше не идём.
 */
export async function syncRecentDays(days: number): Promise<SyncResult> {
  const today = ymdToDateOnly(tashkentTodayYmd());
  let result: SyncResult | null = null;
  for (let i = days - 1; i >= 0; i -= 1) {
    result = await syncAttendanceFromTimePay(new Date(today.getTime() - i * DAY_MS).toISOString().slice(0, 10));
    if (result.status !== 'SUCCESS') break;
  }
  return result!;
}

export { tashkentTodayYmd };

export function assertYmd(value: string | undefined): string {
  if (!value) return tashkentTodayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'Некорректная дата (ожидается YYYY-MM-DD)');
  }
  return value;
}
