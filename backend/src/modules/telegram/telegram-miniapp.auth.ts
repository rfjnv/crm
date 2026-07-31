import { createHmac, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AppError } from '../../lib/errors';
import { config } from '../../lib/config';

/**
 * Проверка initData из Telegram Web App.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Подпись считается на HMAC-SHA256 с ключом `HMAC_SHA256("WebAppData", bot_token)`,
 * поэтому доверять данным можно только пока токен бота не утёк.
 */

export interface TelegramMiniAppUser {
  id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    tgUser?: TelegramMiniAppUser;
  }
}

/** initData считается протухшей через сутки — столько же живёт открытая мини-аппа. */
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

/**
 * Разбор initData вручную: URLSearchParams превращает литеральный «+» в пробел,
 * а в строке подписи значения должны быть ровно такими, какими их посчитал Telegram.
 */
function parseInitData(initData: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const pair of initData.split('&')) {
    if (!pair) continue;
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const key = decodeURIComponent(pair.slice(0, separator));
    const value = decodeURIComponent(pair.slice(separator + 1));
    result.set(key, value);
  }
  return result;
}

function buildCheckString(params: Map<string, string>, skip: string[]): string {
  return [...params.entries()]
    .filter(([key]) => !skip.includes(key))
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
}

function hashMatches(checkString: string, botToken: string, providedHash: string): boolean {
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = Buffer.from(createHmac('sha256', secretKey).update(checkString).digest('hex'), 'hex');
  const provided = Buffer.from(providedHash, 'hex');
  return expected.length === provided.length && expected.length > 0 && timingSafeEqual(expected, provided);
}

export function verifyTelegramInitData(initData: string, botToken: string): TelegramMiniAppUser | null {
  if (!initData || !botToken) return null;

  const params = parseInitData(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  /**
   * Telegram считает hash по всем полученным полям кроме hash. Поле signature (Bot API 8.0+)
   * у разных клиентов то входит в строку подписи, то нет, поэтому принимаем оба варианта:
   * подделать любой из них без токена бота всё равно нельзя.
   */
  const withSignature = buildCheckString(params, ['hash']);
  const withoutSignature = buildCheckString(params, ['hash', 'signature']);

  if (!hashMatches(withSignature, botToken, hash) && !hashMatches(withoutSignature, botToken, hash)) {
    console.warn('[Mini app] initData signature mismatch:', {
      fields: [...params.keys()].sort().join(','),
      hashLength: hash.length,
    });
    return null;
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return null;
  if (Math.floor(Date.now() / 1000) - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const rawUser = params.get('user');
  if (!rawUser) return null;

  try {
    const parsed = JSON.parse(rawUser) as {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    if (!parsed.id || !Number.isFinite(parsed.id)) return null;

    return {
      id: Number(parsed.id),
      firstName: parsed.first_name,
      lastName: parsed.last_name,
      username: parsed.username,
      languageCode: parsed.language_code,
    };
  } catch {
    return null;
  }
}

/** Мини-аппа шлёт initData заголовком, чтобы подпись не оседала в логах URL. */
export function requireTelegramMiniAppUser(req: Request, _res: Response, next: NextFunction): void {
  const token = config.telegram.clientBotToken;
  if (!token) {
    next(new AppError(503, 'Telegram client bot is not configured'));
    return;
  }

  const initData = String(req.header('x-telegram-init-data') || '');
  if (!initData) {
    // Клиент Telegram не передал подписанные данные — обычно очень старая версия приложения
    console.warn('[Mini app] request without initData header');
    next(new AppError(401, 'INIT_DATA_MISSING'));
    return;
  }

  const user = verifyTelegramInitData(initData, token);
  if (!user) {
    next(new AppError(401, 'INIT_DATA_INVALID'));
    return;
  }

  req.tgUser = user;
  next();
}
