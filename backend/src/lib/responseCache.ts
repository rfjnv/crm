import { Request, Response, NextFunction } from 'express';
import { hasCostAccess } from './costAccess';

/**
 * Короткий кеш ответов тяжёлой аналитики (дашборд, аналитика, долги, история).
 *
 * Ключ — пользователь, его доступ к деньгам и себестоимости и полный URL с параметрами:
 * у менеджера и админа разные данные. Хранится ответ ДО вычистки денежных полей —
 * authenticate вычищает их заново при каждой выдаче, так что кеш права не обходит.
 *
 * Любая успешная запись через API (сделка, платёж, клиент, права пользователя…) сбрасывает
 * весь кеш, поэтому после своих действий человек сразу видит свежие цифры. Изменения
 * в обход HTTP (Telegram-бот, планировщики) появятся не позже чем через TTL.
 */

interface Entry {
  expiresAt: number;
  body: unknown;
}

const MAX_ENTRIES = 1000;
const store = new Map<string, Entry>();
/** Растёт на каждой записи: ответ, который начали считать до неё, в кеш не кладём. */
let generation = 0;

export function invalidateResponseCache(): void {
  generation++;
  store.clear();
}

function cacheKey(req: Request): string | null {
  const user = req.user;
  if (!user) return null;
  const cost = hasCostAccess(user) ? 'cost' : 'nocost';
  return `${user.userId}|${user.moneyAccess ?? 'FULL'}|${cost}|${req.originalUrl}`;
}

export function responseCache(ttlMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    const key = cacheKey(req);
    if (!key) {
      next();
      return;
    }

    const hit = store.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      res.setHeader('X-Cache', 'HIT');
      res.json(hit.body);
      return;
    }
    if (hit) store.delete(key);

    const startedAt = generation;
    // Берём текущий res.json (с вычисткой денег от authenticate) и кладём в кеш то,
    // что отдал обработчик, — ещё до вычистки.
    const sendJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode === 200 && startedAt === generation) {
        if (store.size >= MAX_ENTRIES) {
          const oldest = store.keys().next().value;
          if (oldest !== undefined) store.delete(oldest);
        }
        store.set(key, { expiresAt: Date.now() + ttlMs, body });
      }
      res.setHeader('X-Cache', 'MISS');
      return sendJson(body);
    };
    next();
  };
}

/** Записи, после которых аналитика не меняется: трекинг, пинги, чат, push, вход. */
const NON_DATA_WRITES = [
  '/api/activity',
  '/api/presence',
  '/api/push',
  '/api/auth',
  '/api/supabase-auth',
  '/api/notifications',
  '/api/conversations',
];

/** Вешается на всё приложение: успешная запись сбрасывает кеш аналитики. */
export function invalidateCacheOnWrite(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const path = req.originalUrl.split('?')[0];
    if (!NON_DATA_WRITES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      res.on('finish', () => {
        if (res.statusCode < 400) invalidateResponseCache();
      });
    }
  }
  next();
}
