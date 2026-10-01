import express, { NextFunction, Request, Response } from 'express';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateCacheOnWrite, invalidateResponseCache, responseCache } from './responseCache';

let computed = 0;
let releaseSlow: (() => void) | null = null;
let base = '';
let server: ReturnType<express.Express['listen']>;

/** Как authenticate: кладёт пользователя и оборачивает res.json вычисткой денег. */
function fakeAuth(req: Request, res: Response, next: NextFunction) {
  const userId = String(req.headers['x-user'] ?? 'u1');
  const moneyAccess = String(req.headers['x-money'] ?? 'FULL');
  req.user = { userId, role: 'ADMIN', permissions: [], moneyAccess } as unknown as Request['user'];
  if (moneyAccess !== 'FULL') {
    const original = res.json.bind(res);
    res.json = (body: unknown) => original({ ...(body as object), revenue: null });
  }
  next();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(invalidateCacheOnWrite);
  const api = express.Router();
  api.use(fakeAuth, responseCache(60_000));
  api.get('/report', (req, res) => {
    computed++;
    res.json({ revenue: 100, n: computed, user: req.user!.userId });
  });
  api.get('/slow', async (_req, res) => {
    computed++;
    await new Promise<void>((resolve) => { releaseSlow = resolve; });
    res.json({ n: computed });
  });
  app.use('/api/analytics', api);
  app.post('/api/deals', (_req, res) => { res.json({ ok: true }); });
  app.post('/api/deals/fail', (_req, res) => { res.status(400).json({ error: 'x' }); });
  app.post('/api/activity', (_req, res) => { res.json({ ok: true }); });
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  invalidateResponseCache();
  computed = 0;
});

const get = async (path: string, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { headers });
  return { cache: r.headers.get('x-cache'), body: await r.json() };
};
const post = (path: string) => fetch(base + path, { method: 'POST' });

describe('responseCache', () => {
  it('второй запрос отдаётся из кеша', async () => {
    expect((await get('/api/analytics/report')).cache).toBe('MISS');
    const second = await get('/api/analytics/report');
    expect(second.cache).toBe('HIT');
    expect(computed).toBe(1);
  });

  it('параметры запроса — разные ключи', async () => {
    await get('/api/analytics/report?period=day');
    expect((await get('/api/analytics/report?period=month')).cache).toBe('MISS');
  });

  it('у каждого пользователя свой кеш', async () => {
    await get('/api/analytics/report', { 'x-user': 'admin' });
    const other = await get('/api/analytics/report', { 'x-user': 'manager' });
    expect(other.cache).toBe('MISS');
    expect(other.body.user).toBe('manager');
  });

  it('денежные поля вычищаются и при выдаче из кеша', async () => {
    await get('/api/analytics/report', { 'x-user': 'm', 'x-money': 'NONE' });
    const hit = await get('/api/analytics/report', { 'x-user': 'm', 'x-money': 'NONE' });
    expect(hit.cache).toBe('HIT');
    expect(hit.body.revenue).toBeNull();
  });

  it('успешная запись сбрасывает кеш', async () => {
    await get('/api/analytics/report');
    await post('/api/deals');
    expect((await get('/api/analytics/report')).cache).toBe('MISS');
  });

  it('неудачная запись и пинги активности кеш не сбрасывают', async () => {
    await get('/api/analytics/report');
    await post('/api/deals/fail');
    await post('/api/activity');
    expect((await get('/api/analytics/report')).cache).toBe('HIT');
  });

  it('ответ, посчитанный до записи, в кеш не попадает', async () => {
    const pending = get('/api/analytics/slow');
    while (!releaseSlow) await new Promise((r) => setTimeout(r, 5));
    await post('/api/deals');
    releaseSlow();
    releaseSlow = null;
    await pending;
    const again = get('/api/analytics/slow');
    while (!releaseSlow) await new Promise((r) => setTimeout(r, 5));
    releaseSlow();
    releaseSlow = null;
    expect((await again).cache).toBe('MISS');
  }, 10_000);
});
