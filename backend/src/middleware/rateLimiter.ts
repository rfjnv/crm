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

export function rateLimiter(windowMs: number, maxAttempts: number) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.path}`;
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
