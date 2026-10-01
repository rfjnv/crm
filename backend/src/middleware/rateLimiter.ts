import { createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

/** Чей это запрос для счётчика. Пустая строка — лимит к запросу не применяется. */
export type RateLimitKey = (req: Request) => string;

/** По IP. Весь офис выходит в интернет с одного адреса — для общих маршрутов годится только с большим запасом. */
export const byIp: RateLimitKey = (req) => `ip:${req.ip}`;

/** По пользователю (после authenticate), иначе по IP. */
export const byUserOrIp: RateLimitKey = (req) => (req.user ? `user:${req.user.userId}` : byIp(req));

/** Длинные секреты (токены) в ключ кладём хешем, а не как есть. */
export function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function rateLimiter(windowMs: number, maxAttempts: number, keyOf: RateLimitKey = byIp) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV === 'development') {
      next();
      return;
    }

    const who = keyOf(req);
    if (!who) {
      next();
      return;
    }

    // Окно и лимит тоже в ключе: два лимитера на одном маршруте считают раздельно.
    const key = `${who}:${req.baseUrl}${req.path}:${windowMs}:${maxAttempts}`;
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;

    if (entry.count > maxAttempts) {
      throw new AppError(429, 'Слишком много запросов. Попробуйте позже.');
    }

    next();
  };
}
