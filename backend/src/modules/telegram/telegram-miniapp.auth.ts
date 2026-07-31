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

export function verifyTelegramInitData(initData: string, botToken: string): TelegramMiniAppUser | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  // signature приходит только в Telegram 7.10+ (third-party validation) и в подпись не входит
  params.delete('signature');

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expected = Buffer.from(computedHash, 'hex');
  const provided = Buffer.from(hash, 'hex');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
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
  const user = verifyTelegramInitData(initData, token);
  if (!user) {
    next(new AppError(401, 'Invalid Telegram init data'));
    return;
  }

  req.tgUser = user;
  next();
}
