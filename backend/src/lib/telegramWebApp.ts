import { createHmac } from 'crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/**
 * Проверка initData от Telegram Web App (https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app).
 * secret_key = HMAC_SHA256("WebAppData", bot_token); hash сравнивается с полем hash из initData.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60,
): TelegramWebAppUser | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;

  try {
    return JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    return null;
  }
}
