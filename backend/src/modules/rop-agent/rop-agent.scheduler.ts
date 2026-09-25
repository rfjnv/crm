import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { buildDigest, tashkentYesterday } from './rop-agent.digest';
import { sendDigestToRecipients } from './rop-agent.telegram';
import { runAlerts } from './rop-agent.alerts';

/**
 * Утренняя сводка РОП-агента за вчера: в ROP_DIGEST_HOUR (по умолчанию 9:00 Ташкента)
 * собирается и уходит в Telegram получателям. Окно — первые 30 минут часа, чтобы
 * рестарт сервера в 9:00 не пропустил день. Отправленное помечается sentAt, поэтому
 * второй раз за день не уходит; при ошибке — не больше трёх попыток.
 */

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const attempts = new Map<string, number>();

function digestHour(): number | null {
  const raw = config.ropAgent.digestHour.toLowerCase();
  if (raw === 'off' || raw === '') return null;
  const h = Number(raw);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
}

async function tick(): Promise<void> {
  const hour = digestHour();
  if (hour === null) return;
  const now = new Date(Date.now() + TASHKENT_OFFSET_MS);
  if (now.getUTCHours() !== hour || now.getUTCMinutes() >= 30) return;

  const date = tashkentYesterday();
  if ((attempts.get(date) ?? 0) >= MAX_ATTEMPTS) return;
  const existing = await prisma.ropDailyDigest.findUnique({ where: { date }, select: { sentAt: true } });
  if (existing?.sentAt) return;

  attempts.set(date, (attempts.get(date) ?? 0) + 1);
  try {
    // Пересобираем даже если черновик есть: его могли собрать вручную вечером, до конца дня.
    await buildDigest(date);
    const sent = await sendDigestToRecipients(date);
    console.log(`[rop-digest] ${date}: sent to ${sent} recipient(s)`);
  } catch (err) {
    console.error(`[rop-digest] ${date} failed:`, (err as Error).message);
  }
}

/**
 * Сигналы: раз в час с 10:00 до 19:00 по Ташкенту, в первые 5 минут часа. После
 * утренней сводки (она в 9:00) и не ночью — директору это приходит в Telegram.
 */
const ALERT_HOURS = { from: 10, to: 19 };
let lastAlertHour = '';

async function alertsTick(): Promise<void> {
  if (!config.ropAgent.alertsEnabled) return;
  const now = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const hour = now.getUTCHours();
  if (hour < ALERT_HOURS.from || hour > ALERT_HOURS.to || now.getUTCMinutes() >= 5) return;
  const key = `${now.toISOString().slice(0, 10)}T${hour}`;
  if (lastAlertHour === key) return;
  lastAlertHour = key;
  const r = await runAlerts();
  if (r.reviewed) console.log(`[rop-alerts] reviewed ${r.reviewed}, sent ${r.sent}`);
}

setInterval(() => {
  tick().catch((err) => console.error('[rop-digest] tick failed:', (err as Error).message));
  alertsTick().catch((err) => console.error('[rop-alerts] tick failed:', (err as Error).message));
}, 60_000);
