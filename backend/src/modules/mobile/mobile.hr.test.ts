import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './__tests__/fakePrisma';

const state = vi.hoisted(() => ({ fake: null as any }));

vi.mock('../../lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, key) => state.fake.prisma[key] }),
}));
vi.mock('../telegram/telegram.service', () => ({ telegramService: { sendToUser: vi.fn(async () => {}) } }));
vi.mock('./mobile.settings', () => ({
  getMobileSettings: vi.fn(async () => ({ autoAuditEnabled: true, minAuditDurationSec: 30, syncIntervalMin: 15, wifiOnlyAboveMb: 20 })),
}));
vi.mock('./mobile.storage', () => ({ signedUrl: vi.fn(async (p: string) => `https://signed/${p}`) }));
// Пользователь запроса — из заголовка: проверяем права маршрутов, а не JWT
vi.mock('../../middleware/authenticate', () => ({
  authenticate: (req: any, _res: unknown, next: () => void) => {
    req.user = JSON.parse(String(req.headers['x-test-user']));
    next();
  },
}));

import { ingestCalls } from './mobile.service';
import { autoAnalysisSkipReason } from './mobile.auto-analysis';
import { clientCalls, getAudioUrl, getCall, listCalls } from './calls.service';
import { callLeaderIds } from './mobile.access';
import { telegramService } from '../telegram/telegram.service';
import { NOT_SERVICE } from '../rop-agent/rop-agent.phone-calls';
import hrCallsRoutes from './hr-calls.routes';
import { errorHandler } from '../../middleware/errorHandler';

const director = { userId: 'boss', role: 'SUPER_ADMIN', permissions: [] as string[] };
const admin = { userId: 'admin', role: 'ADMIN', permissions: [] as string[] };
const rop = { userId: 'rop', role: 'MANAGER', permissions: ['use_rop_agent'] };
const viewer = { userId: 'viewer', role: 'ACCOUNTANT', permissions: ['view_hr_calls'] };
const hr1 = { userId: 'hr1', role: 'HR', permissions: [] as string[] };
const hr2 = { userId: 'hr2', role: 'HR', permissions: [] as string[] };
const manager = { userId: 'm1', role: 'MANAGER', permissions: [] as string[] };

const hrDevice = { id: 'dev-hr', userId: 'hr1', model: null, recordingsPathOverride: null, simSlot: null, uploadLogsRequested: false, channel: 'HR' as const };
const salesDevice = { id: 'dev-m1', userId: 'm1', model: null, recordingsPathOverride: null, simSlot: null, uploadLogsRequested: false, channel: 'SALES' as const };

let seq = 0;
const call = (over: Record<string, unknown> = {}) => {
  seq += 1;
  return {
    device_call_id: `c${seq}`,
    phone: '+998901234567',
    direction: 'in',
    started_at: new Date(Date.now() - 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration_sec: 120,
    ...over,
  };
};

/** Звонок «приходит с телефона» — как в проде */
async function arrive(device: typeof hrDevice | typeof salesDevice | (typeof hrDevice & { userId: string }), over: Record<string, unknown> = {}) {
  const { vi: _v, ...rest } = { vi: 0, ...over };
  const out = await ingestCalls(device, { calls: [call(rest)] });
  const id = (out.results[0] as { call_id: string }).call_id;
  // ingestCalls сам обрабатывает новый звонок (клиент, задачи, связи)
  return state.fake.db.callSession.find((c: any) => c.id === id);
}

let server: Server;
let base: string;
beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/hr-calls', hrCallsRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

beforeEach(() => {
  state.fake = createFakePrisma();
  // Клиент с тем же номером, что звонит на телефон HR, — к звонку HR он привязаться не должен
  state.fake.db.client.push({ id: 'c1', phone: '+998 90 123 45 67', managerId: 'm1', companyName: 'Print House', isArchived: false });
  state.fake.db.user.push(
    { id: 'hr1', fullName: 'Гулнора HR', role: 'HR', isActive: true },
    { id: 'hr2', fullName: 'Вторая HR', role: 'HR', isActive: true },
    { id: 'm1', fullName: 'Дилноза Каримова', role: 'MANAGER', isActive: true },
  );
  vi.mocked(telegramService.sendToUser).mockClear();
});

describe('звонок с телефона HR', () => {
  it('получает channel = HR, не привязывается к клиенту и не уходит в автоанализ', async () => {
    const c = await arrive(hrDevice);
    expect(c).toMatchObject({ channel: 'HR', clientId: null });
    await expect(autoAnalysisSkipReason({ durationSec: 600, phoneKey: '901234567', channel: 'HR' })).resolves.toBe('Звонок HR — не анализируем');
    // У продаж тот же номер — клиент находится
    const s = await arrive(salesDevice);
    expect(s).toMatchObject({ channel: 'SALES', clientId: 'c1' });
  });

  it('пропущенный HR — задача и Telegram только самой HR', async () => {
    const m = await arrive(hrDevice, { direction: 'missed', duration_sec: 0 });
    expect(state.fake.db.task).toHaveLength(1);
    expect(state.fake.db.task[0]).toMatchObject({ assigneeId: 'hr1', createdById: 'hr1', callSessionId: m.id });
    expect(telegramService.sendToUser).toHaveBeenCalledTimes(1);
    expect(telegramService.sendToUser).toHaveBeenCalledWith('hr1', expect.objectContaining({ url: `/hr-calls?call=${m.id}` }));
  });

  it('разговор HR закрывает только задачи HR; пропущенный продаж задачу не ставит', async () => {
    await arrive(hrDevice, { direction: 'missed', duration_sec: 0 });
    state.fake.db.task.push({ id: 'sales-task', title: 'Перезвонить', status: 'TODO', assigneeId: 'm1', callSessionId: (await arrive(salesDevice, { direction: 'missed', duration_sec: 0 })).id });
    expect(state.fake.db.task).toHaveLength(2);
    await arrive(hrDevice, { direction: 'out', duration_sec: 60 });
    const byId = Object.fromEntries(state.fake.db.task.map((t: any) => [t.id, t.status]));
    expect(byId['sales-task']).toBe('TODO');
    expect(Object.values(byId).filter((v) => v === 'DONE')).toHaveLength(1);
  });

  it('алерты по телефону HR — только директору', async () => {
    state.fake.db.user.push(
      { id: 'boss', role: 'SUPER_ADMIN', permissions: [], isActive: true, telegramChatId: '1' },
      { id: 'rop', role: 'MANAGER', permissions: ['use_rop_agent'], isActive: true, telegramChatId: '2' },
    );
    state.fake.prisma.user.findMany = vi.fn(async ({ where }: any) => state.fake.db.user.filter((u: any) =>
      u.isActive && u.telegramChatId && where.OR.some((c: any) => (c.role && u.role === c.role) || (c.permissions && (u.permissions ?? []).includes(c.permissions.has)))));
    await expect(callLeaderIds('HR')).resolves.toEqual(['boss']);
    await expect(callLeaderIds('SALES')).resolves.toEqual(['boss', 'rop']);
  });
});

describe('звонки HR не попадают в продажи', () => {
  it('журнал «Звонки» не показывает их никому, даже директору; карточка клиента — тоже', async () => {
    const hrCall = await arrive(hrDevice);
    // Даже если бы звонку HR кто-то проставил клиента — в карточке клиента его нет
    hrCall.clientId = 'c1';
    await arrive(salesDevice);
    const journal = await listCalls(director, { page: 1, pageSize: 30 });
    expect(journal.items.map((i) => i.id)).not.toContain(hrCall.id);
    expect(journal.totalCount).toBe(1);
    const card = await clientCalls(director, 'c1');
    expect(card.items.map((i) => i.id)).not.toContain(hrCall.id);
    await expect(getCall(director, hrCall.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('KPI и выборки РОП-агента отсекают поток HR', () => {
    expect(NOT_SERVICE.sql).toContain("cs.channel = 'SALES'");
  });
});

describe('доступ к звонкам HR', () => {
  it('ADMIN и РОП — 404 на звонок HR и его запись; директор и view_hr_calls — видят', async () => {
    const c = await arrive(hrDevice);
    c.recordingPath = 'hr1/2026/11/rec.m4a';
    for (const u of [admin, rop]) {
      await expect(getCall(u, c.id, 'HR')).rejects.toMatchObject({ statusCode: 404 });
      await expect(getAudioUrl(u, c.id, 'https://api.test', 'HR')).rejects.toMatchObject({ statusCode: 404 });
      await expect(getAudioUrl(u, c.id, 'https://api.test', 'SALES')).rejects.toMatchObject({ statusCode: 404 });
    }
    for (const u of [director, viewer]) {
      await expect(getCall(u, c.id, 'HR')).resolves.toMatchObject({ id: c.id });
      await expect(getAudioUrl(u, c.id, 'https://api.test', 'HR')).resolves.toMatchObject({ url: 'https://signed/hr1/2026/11/rec.m4a' });
    }
  });

  it('HR видит только свои звонки HR', async () => {
    const own = await arrive(hrDevice);
    const other = await arrive({ ...hrDevice, id: 'dev-hr2', userId: 'hr2' });
    const list = await listCalls(hr1, { page: 1, pageSize: 30 }, 'HR');
    expect(list.items.map((i) => i.id)).toEqual([own.id]);
    await expect(getCall(hr1, other.id, 'HR')).rejects.toMatchObject({ statusCode: 404 });
    const all = await listCalls(director, { page: 1, pageSize: 30 }, 'HR');
    expect(all.totalCount).toBe(2);
  });

  it('раздел «Звонки HR»: менеджеру, ADMIN и РОП — 403; HR и директору — список', async () => {
    await arrive(hrDevice);
    const get = (u: object) => fetch(`${base}/api/hr-calls`, { headers: { 'x-test-user': JSON.stringify(u) } }).then((r) => r.status);
    expect(await get(manager)).toBe(403);
    expect(await get(admin)).toBe(403);
    expect(await get(rop)).toBe(403);
    expect(await get(hr1)).toBe(200);
    expect(await get(hr2)).toBe(200);
    expect(await get(director)).toBe(200);
    expect(await get(viewer)).toBe(200);
  });
});
