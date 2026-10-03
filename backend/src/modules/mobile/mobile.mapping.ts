import type { CallDirection, CallSessionStatus } from '@prisma/client';
import { phoneMatchKey } from '../../lib/phone';
import { TASHKENT_OFFSET_MS } from '../../lib/tz';

/** Направления звонка, которые присылает CallSync (как в журнале звонков Android). */
export const MOBILE_CALL_TYPES = [
  'in',
  'out',
  'out_unanswered',
  'missed',
  'rejected',
  'blocked',
  'voicemail',
  'answered_externally',
] as const;
export type MobileCallType = (typeof MOBILE_CALL_TYPES)[number];

export const MOBILE_CALL_TYPE_LABELS: Record<MobileCallType, string> = {
  in: 'Входящий',
  out: 'Исходящий',
  out_unanswered: 'Исходящий без ответа',
  missed: 'Пропущенный',
  rejected: 'Отклонённый',
  blocked: 'Заблокированный',
  voicemail: 'Голосовая почта',
  answered_externally: 'Принят на другом устройстве',
};

const OUTBOUND_TYPES = new Set<string>(['out', 'out_unanswered']);

/**
 * Направление и статус звонка в терминах CallSession.
 * Разговор состоялся (`in`/`out` с длительностью больше 0, `answered_externally`) — COMPLETED;
 * всё остальное — MISSED для входящих и FAILED для исходящих.
 */
export function mapMobileCall(type: MobileCallType, durationSec: number): { direction: CallDirection; status: CallSessionStatus } {
  const direction: CallDirection = OUTBOUND_TYPES.has(type) ? 'OUTBOUND' : 'INBOUND';
  if (type === 'answered_externally') return { direction, status: 'COMPLETED' };
  if ((type === 'in' || type === 'out') && durationSec > 0) return { direction, status: 'COMPLETED' };
  return { direction, status: direction === 'INBOUND' ? 'MISSED' : 'FAILED' };
}

/** Пропущенные, по которым нужно перезвонить. blocked и voicemail — нет. */
export const CALLBACK_TYPES: MobileCallType[] = ['missed', 'rejected'];

export function needsCallback(type: string | null | undefined): boolean {
  return !!type && (CALLBACK_TYPES as string[]).includes(type);
}

/** Состоялся разговор с номером — значит, перезванивать уже не нужно. */
export function isConversation(type: string | null | undefined, durationSec: number | null | undefined): boolean {
  return (type === 'in' || type === 'out') && (durationSec ?? 0) > 0;
}

/** externalCallId мобильного звонка: уникальный индекс даёт идемпотентность по (сотрудник, device_call_id). */
export function mobileExternalId(userId: string, deviceCallId: string): string {
  return `mobile:${userId}:${deviceCallId}`;
}

/** Короче — служебные номера (900, 1050): клиента по ним не ищем. */
const MIN_KEY_LENGTH = 7;

/** Ключ номера для поиска клиента и задач; пустая строка — не ищем. */
export function callPhoneKey(phone: string | null | undefined): string {
  const key = phoneMatchKey(phone);
  return key.length >= MIN_KEY_LENGTH ? key : '';
}

/** В Client.phone бывает несколько номеров через «,», «;» или «/». */
export function splitClientPhones(field: string | null | undefined): string[] {
  if (!field) return [];
  return field.split(/[,;/]/).map((p) => p.trim()).filter(Boolean);
}

export function clientPhoneKeys(field: string | null | undefined): string[] {
  return [...new Set(splitClientPhones(field).map(callPhoneKey).filter(Boolean))];
}

// ─── Рабочее время (по Ташкенту) ────────────────────────────────────────────

export interface WorkHours {
  workStartHour: number;
  workEndHour: number;
  /** 1 — понедельник … 7 — воскресенье */
  workDays: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function tashkentDow(t: Date): number {
  const d = new Date(t.getTime() + TASHKENT_OFFSET_MS).getUTCDay();
  return d === 0 ? 7 : d;
}

export function isWorkingTime(at: Date, wh: WorkHours): boolean {
  const local = new Date(at.getTime() + TASHKENT_OFFSET_MS);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  return wh.workDays.includes(tashkentDow(at)) && hour >= wh.workStartHour && hour < wh.workEndHour;
}

/**
 * Сколько рабочего времени прошло между двумя моментами. «Телефон молчит 2 часа в рабочее
 * время» — это 2 часа именно рабочего времени: вечер и ночь не считаются, иначе в 9:00
 * алерт приходил бы по каждому телефону, выключенному на ночь.
 */
export function workingMsBetween(from: Date, to: Date, wh: WorkHours): number {
  if (to <= from) return 0;
  // Не дальше месяца назад: дальше результат уже заведомо больше любого порога
  const start = Math.max(from.getTime(), to.getTime() - 31 * DAY_MS);
  const end = to.getTime();
  let total = 0;
  // Полночь по Ташкенту того дня, где start
  let dayStart = Math.floor((start + TASHKENT_OFFSET_MS) / DAY_MS) * DAY_MS - TASHKENT_OFFSET_MS;
  for (; dayStart < end; dayStart += DAY_MS) {
    if (!wh.workDays.includes(tashkentDow(new Date(dayStart)))) continue;
    const ws = dayStart + wh.workStartHour * HOUR_MS;
    const we = dayStart + wh.workEndHour * HOUR_MS;
    const overlap = Math.min(we, end) - Math.max(ws, start);
    if (overlap > 0) total += overlap;
  }
  return total;
}

/** «14:05» или «03.10 14:05», если не сегодня — по Ташкенту. */
export function formatTashkentTime(at: Date, now: Date = new Date()): string {
  const l = new Date(at.getTime() + TASHKENT_OFFSET_MS);
  const n = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const pad = (v: number) => String(v).padStart(2, '0');
  const time = `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`;
  const sameDay = l.toISOString().slice(0, 10) === n.toISOString().slice(0, 10);
  return sameDay ? time : `${pad(l.getUTCDate())}.${pad(l.getUTCMonth() + 1)} ${time}`;
}
