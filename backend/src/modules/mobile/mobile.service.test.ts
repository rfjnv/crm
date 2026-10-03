import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './__tests__/fakePrisma';

const state = vi.hoisted(() => ({ fake: null as any }));

vi.mock('../../lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, key) => state.fake.prisma[key] }),
}));
vi.mock('./mobile.processing', () => ({ processNewMobileCall: vi.fn(async () => {}) }));
vi.mock('./mobile.settings', () => ({
  getMobileSettings: vi.fn(async () => ({ autoAuditEnabled: true, minAuditDurationSec: 30, syncIntervalMin: 15, wifiOnlyAboveMb: 20 })),
}));
vi.mock('./mobile.storage', () => ({
  audioExt: (name: string) => name.split('.').pop() ?? 'bin',
  audioMime: () => 'audio/mp4',
  uploadFile: vi.fn(async () => {}),
  removeFiles: vi.fn(async () => {}),
}));
vi.mock('../auth/auth.service', () => ({ authService: { verifyCredentials: vi.fn() } }));

import { ingestCalls, receiveAudio } from './mobile.service';
import { processNewMobileCall } from './mobile.processing';
import { uploadFile } from './mobile.storage';

const device = { id: 'dev-1', userId: 'manager-1', model: null, recordingsPathOverride: null, simSlot: null, uploadLogsRequested: false };
const call = (over: Record<string, unknown> = {}) => ({
  device_call_id: 'a'.repeat(64),
  phone: '+998901234567',
  phone_raw: '90 123 45 67',
  direction: 'in',
  started_at: '2026-10-03T09:25:30Z',
  duration_sec: 184,
  sim_slot: 1,
  ...over,
});

beforeEach(() => {
  state.fake = createFakePrisma();
  vi.mocked(processNewMobileCall).mockClear();
});

describe('POST /api/calls — идемпотентность', () => {
  it('повтор того же события — duplicate с тем же call_id', async () => {
    const first = await ingestCalls(device, { calls: [call()] });
    expect(first.results[0]).toMatchObject({ status: 'created' });
    const id = (first.results[0] as { call_id: string }).call_id;

    const second = await ingestCalls(device, { calls: [call()] });
    expect(second.results[0]).toEqual({ device_call_id: 'a'.repeat(64), status: 'duplicate', call_id: id });
    expect(state.fake.db.callSession).toHaveLength(1);
    expect(processNewMobileCall).toHaveBeenCalledTimes(1);
  });

  it('пишет звонок в CallSession с externalCallId mobile:<userId>:<device_call_id>', async () => {
    await ingestCalls(device, { calls: [call({ direction: 'missed', duration_sec: 0 })] });
    const row = state.fake.db.callSession[0];
    expect(row).toMatchObject({
      provider: 'MOBILE',
      externalCallId: `mobile:manager-1:${'a'.repeat(64)}`,
      direction: 'INBOUND',
      status: 'MISSED',
      mobileType: 'missed',
      phone: '+998901234567',
      phoneKey: '901234567',
      managerUserId: 'manager-1',
      deviceId: 'dev-1',
    });
  });

  it('у другого сотрудника тот же device_call_id — отдельный звонок', async () => {
    await ingestCalls(device, { calls: [call()] });
    const other = await ingestCalls({ ...device, id: 'dev-2', userId: 'manager-2' }, { calls: [call()] });
    expect(other.results[0]).toMatchObject({ status: 'created' });
    expect(state.fake.db.callSession).toHaveLength(2);
  });

  it('невалидный элемент — error, остальные обрабатываются', async () => {
    const out = await ingestCalls(device, {
      calls: [call({ device_call_id: 'x1', direction: 'sideways' }), call({ device_call_id: 'x2' }), 'мусор'],
    });
    expect(out.results[0]).toEqual({ device_call_id: 'x1', status: 'error', error: 'invalid direction' });
    expect(out.results[1]).toMatchObject({ device_call_id: 'x2', status: 'created' });
    expect(out.results[2]).toMatchObject({ device_call_id: '', status: 'error' });
  });

  it('гонка: параллельный запрос успел создать звонок (P2002) — duplicate, а не ошибка', async () => {
    const first = await ingestCalls(device, { calls: [call()] });
    const id = (first.results[0] as { call_id: string }).call_id;
    // Первая проверка «уже есть?» не видит строку — как при параллельной вставке
    const realFindUnique = state.fake.prisma.callSession.findUnique;
    state.fake.prisma.callSession.findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockImplementation(realFindUnique);
    const out = await ingestCalls(device, { calls: [call()] });
    expect(out.results[0]).toEqual({ device_call_id: 'a'.repeat(64), status: 'duplicate', call_id: id });
  });

  it('больше 100 событий — 400', async () => {
    await expect(ingestCalls(device, { calls: Array.from({ length: 101 }, (_, i) => call({ device_call_id: `c${i}` })) }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('POST /api/calls/:id/audio — идемпотентность по SHA-256', () => {
  let tmp: string;
  let sha: string;
  const content = Buffer.from('fake audio bytes');

  beforeEach(async () => {
    tmp = path.join(os.tmpdir(), `callsync-test-${Date.now()}-${Math.random()}.m4a`);
    await fs.writeFile(tmp, content);
    sha = createHash('sha256').update(content).digest('hex');
    vi.mocked(uploadFile).mockClear();
  });
  afterEach(async () => {
    await fs.unlink(tmp).catch(() => {});
  });

  const file = () => ({ path: tmp, originalname: 'recording.m4a', size: content.length });

  it('первая загрузка — created, повтор с тем же хэшем — 200 duplicate с тем же audio_id', async () => {
    await ingestCalls(device, { calls: [call()] });
    const callId = state.fake.db.callSession[0].id;

    const first = await receiveAudio(device, file(), { duration_sec: '184' }, sha, callId);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'created', duration: 184 });
    expect(state.fake.db.callSession[0]).toMatchObject({ audioStatus: 'UPLOADED' });
    expect(state.fake.db.callSession[0].recordingPath).toMatch(/^manager-1\/2026\/10\/[0-9a-f-]+\.m4a$/);

    const again = await receiveAudio(device, file(), {}, sha, callId);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: 'duplicate', audio_id: first.body.audio_id });
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(state.fake.db.callRecording).toHaveLength(1);
  });

  it('X-Audio-SHA256 не совпадает с файлом — 400', async () => {
    await expect(receiveAudio(device, file(), {}, '0'.repeat(64), null)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('чужой звонок — 404', async () => {
    await ingestCalls({ ...device, userId: 'manager-2' }, { calls: [call()] });
    const foreignId = state.fake.db.callSession[0].id;
    await expect(receiveAudio(device, file(), {}, sha, foreignId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('короткий звонок — запись сохраняется, но в аудит не идёт (SKIPPED)', async () => {
    await ingestCalls(device, { calls: [call({ duration_sec: 12 })] });
    const callId = state.fake.db.callSession[0].id;
    await receiveAudio(device, file(), {}, sha, callId);
    expect(state.fake.db.callSession[0]).toMatchObject({ audioStatus: 'SKIPPED' });
  });

  it('несопоставленная запись, позже пришедшая для звонка, привязывается без второго файла', async () => {
    const unmatched = await receiveAudio(device, file(), { file_modified_at: '2026-10-03T09:30:00Z' }, sha, null);
    await ingestCalls(device, { calls: [call()] });
    const callId = state.fake.db.callSession[0].id;
    const matched = await receiveAudio(device, file(), {}, sha, callId);
    expect(matched.body).toMatchObject({ status: 'duplicate', audio_id: unmatched.body.audio_id });
    expect(state.fake.db.callRecording[0].callSessionId).toBe(callId);
    expect(state.fake.db.callSession[0].audioStatus).toBe('UPLOADED');
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });
});
