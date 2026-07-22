import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../lib/config';

export type TelegramTransportMode = 'webhook' | 'polling';

export function getTelegramTransportMode(): TelegramTransportMode {
  return config.telegram.backendPublicUrl ? 'webhook' : 'polling';
}

/**
 * В режиме polling чистим возможный старый webhook (оставшийся от прод-деплоя), чтобы
 * локальный/дублирующий процесс с тем же токеном не блокировался Telegram.
 * В режиме webhook создаём «голый» инстанс — сами дёргаем processUpdate из Express-роута,
 * не используя встроенный HTTPS-сервер библиотеки.
 */
export function createTelegramBot(token: string): TelegramBot {
  if (getTelegramTransportMode() === 'polling') {
    const bot = new TelegramBot(token, { polling: false });
    bot.deleteWebHook()
      .catch(() => {})
      .finally(() => {
        bot.startPolling().catch((err: Error) => {
          console.error('[Telegram] startPolling failed:', err.message);
        });
      });
    return bot;
  }

  return new TelegramBot(token, {});
}

export async function registerWebhook(bot: TelegramBot, path: string, label: string): Promise<void> {
  if (getTelegramTransportMode() !== 'webhook') return;

  const url = `${config.telegram.backendPublicUrl}${path}`;
  try {
    await bot.setWebHook(url, config.telegram.webhookSecret ? { secret_token: config.telegram.webhookSecret } : undefined);
    console.log(`[Telegram] ${label} webhook set → ${url}`);
  } catch (err) {
    console.error(`[Telegram] ${label} setWebHook failed:`, (err as Error).message);
  }
}
