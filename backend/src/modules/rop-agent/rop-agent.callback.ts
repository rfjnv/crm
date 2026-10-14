import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { isAllowedTelegramId } from './rop-agent.people';

/**
 * «Белла, позвони мне»: очередь исходящих звонков для моста (call-bridge). Мост — фоновый
 * сервис без входящего адреса, поэтому он сам раз в несколько секунд забирает очередь
 * (GET /api/public/rop-call/bridge-queue) и звонит с аккаунта Беллы.
 */

const REQUEST_TTL_MS = 2 * 60 * 1000;
/** Мост опрашивает очередь каждые ~3 с; дольше минуты тишины — считаем, что он не запущен. */
const BRIDGE_ALIVE_MS = 60 * 1000;

/** Что звонить: «перезвони мне» (только Telegram ID) или поручение менеджеру (missionId). */
export type QueuedCall = { telegramId: string; missionId?: string; phone?: string; name?: string };

const pending = new Map<string, QueuedCall & { expires: number }>();
let lastPoll = 0;

/** Мост опрашивал очередь недавно — значит, запущен. */
export function bridgeAlive(): boolean {
  return Date.now() - lastPoll <= BRIDGE_ALIVE_MS;
}

/** Поставить звонок в очередь (ключ — кому звоним: один звонок на человека за раз). */
export function enqueueCall(call: QueuedCall): void {
  pending.set(call.telegramId, { ...call, expires: Date.now() + REQUEST_TTL_MS });
}

/** Telegram ID сотрудника (HOS_USERS или привязанный Telegram), только из списка доступа. */
export async function telegramIdOfUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { login: true, telegramChatId: true } });
  if (!user) return null;
  const mapped = Object.entries(config.hos.users).find(([, login]) => login === user.login)?.[0];
  const id = mapped ?? user.telegramChatId;
  return id && isAllowedTelegramId(id) ? id : null;
}

export function callbackAvailable(): boolean {
  return config.ropAgent.call.enabled && !!config.ropAgent.call.bridgeSecret;
}

/** Поставить звонок в очередь. Возвращает, что сказать человеку. */
export function requestCallbackByTelegramId(telegramId: string): { ok: boolean; message: string } {
  if (!callbackAvailable()) return { ok: false, message: 'Звонки Беллы не настроены (нет моста звонков).' };
  if (!isAllowedTelegramId(telegramId)) return { ok: false, message: 'Этому человеку Белла звонить не может.' };
  if (!bridgeAlive()) {
    return { ok: false, message: 'Мост звонков сейчас не на связи — позвонить не получится. Можно позвонить Белле самому или через кнопку «📞 Позвонить».' };
  }
  enqueueCall({ telegramId });
  return { ok: true, message: 'Белла позвонит в Telegram через несколько секунд.' };
}

export async function requestCallback(userId: string): Promise<{ ok: boolean; message: string }> {
  const telegramId = await telegramIdOfUser(userId);
  if (!telegramId) return { ok: false, message: 'У этого сотрудника нет Telegram в списке доступа — позвонить некуда.' };
  return requestCallbackByTelegramId(telegramId);
}

/** Для моста: забрать очередь (и отметить, что мост жив). */
export function takePendingCallbacks(): QueuedCall[] {
  lastPoll = Date.now();
  const now = Date.now();
  const out: QueuedCall[] = [];
  for (const [id, { expires, ...call }] of pending) {
    if (expires >= now) out.push(call);
    pending.delete(id);
  }
  return out;
}
