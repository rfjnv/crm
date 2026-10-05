import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './__tests__/fakePrisma';

const state = vi.hoisted(() => ({ fake: null as any, audit: [] as unknown[] }));

vi.mock('../../lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, key) => state.fake.prisma[key] }),
}));
// Пользователь запроса — из заголовка: проверяем права маршрута, а не JWT
vi.mock('../../middleware/authenticate', () => ({
  authenticate: (req: any, _res: unknown, next: () => void) => {
    req.user = JSON.parse(String(req.headers['x-test-user']));
    next();
  },
}));
vi.mock('../../lib/logger', () => ({ auditLog: vi.fn(async (entry: unknown) => { state.audit.push(entry); }) }));
vi.mock('../telegram/telegram.service', () => ({ telegramService: { sendToUser: vi.fn(async () => {}) } }));
vi.mock('../auth/auth.service', () => ({ authService: { verifyCredentials: vi.fn() } }));

import mobileRoutes from './mobile.routes';
import { errorHandler } from '../../middleware/errorHandler';

const admin = { userId: 'admin', role: 'ADMIN', permissions: [] };
const rop = { userId: 'rop', role: 'MANAGER', permissions: ['use_rop_agent'] };
const manager = { userId: 'm1', role: 'MANAGER', permissions: [] };

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

beforeEach(() => {
  state.fake = createFakePrisma();
  state.audit = [];
  state.fake.db.user.push(
    { id: 'admin', fullName: 'Азиз Директоров', role: 'ADMIN', isActive: true },
    { id: 'm1', fullName: 'Дилноза Каримова', role: 'MANAGER', isActive: true },
    { id: 'm2', fullName: 'Фарход Алиев', role: 'MANAGER', isActive: true },
    { id: 'gone', fullName: 'Уволенный', role: 'MANAGER', isActive: false },
  );
});

const post = (path: string, body: unknown, user?: object) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': JSON.stringify(user) } : {}) },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() as any }));

describe('POST /api/mobile/pairing-code — телефоны подключает руководство', () => {
  it('менеджер получает 403, даже для себя', async () => {
    const res = await post('/api/mobile/pairing-code', { userId: 'm1' }, manager);
    expect(res.status).toBe(403);
    expect(state.fake.db.mobilePairingCode).toHaveLength(0);
  });

  it('админ создаёт код для сотрудника, и вход по нему выдаёт токен именно этого сотрудника', async () => {
    const code = await post('/api/mobile/pairing-code', { userId: 'm2' }, admin);
    expect(code.status).toBe(200);
    expect(code.body.employee).toEqual({ id: 'm2', name: 'Фарход Алиев' });
    expect(code.body.qr).toMatch(/^callsync:\/\/pair\?server=.+&code=[A-Z0-9]{8}$/);
    expect(state.audit).toEqual([expect.objectContaining({
      userId: 'admin',
      action: 'CREATE',
      entityType: 'mobile_device',
      after: expect.objectContaining({ event: 'pairing_code', forUserId: 'm2', forUserName: 'Фарход Алиев' }),
    })]);

    const login = await post('/api/mobile/auth', { pairing_code: code.body.code, device: { model: 'samsung SM-A346E' } });
    expect(login.status).toBe(200);
    expect(login.body.employee).toEqual({ id: 'm2', name: 'Фарход Алиев' });
    expect(state.fake.db.mobileDevice[0]).toMatchObject({ userId: 'm2', model: 'samsung SM-A346E', active: true });

    // Код одноразовый
    const again = await post('/api/mobile/auth', { pairing_code: code.body.code });
    expect(again.status).toBe(401);
  });

  it('РОП (use_rop_agent) тоже может подключать телефоны', async () => {
    const res = await post('/api/mobile/pairing-code', { userId: 'm1' }, rop);
    expect(res.status).toBe(200);
  });

  it('код для неактивного сотрудника — 400', async () => {
    const res = await post('/api/mobile/pairing-code', { userId: 'gone' }, admin);
    expect(res.status).toBe(400);
    expect(state.fake.db.mobilePairingCode).toHaveLength(0);
  });

  it('без сотрудника — 400, несуществующий — 404', async () => {
    expect((await post('/api/mobile/pairing-code', {}, admin)).status).toBe(400);
    expect((await post('/api/mobile/pairing-code', { userId: 'nobody' }, admin)).status).toBe(404);
  });
});
