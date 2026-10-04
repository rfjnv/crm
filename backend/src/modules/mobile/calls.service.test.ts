import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './__tests__/fakePrisma';

const state = vi.hoisted(() => ({ fake: null as any }));

vi.mock('../../lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, key) => state.fake.prisma[key] }),
}));
vi.mock('../telegram/telegram.service', () => ({ telegramService: { sendToUser: vi.fn(async () => {}) } }));
vi.mock('./mobile.storage', () => ({
  signedUrl: vi.fn(async (p: string) => `https://storage.test/signed/${p}`),
}));

import { getAudioUrl, getCall, linkClient, listCalls, markCalledBack, verifyAudioStreamToken } from './calls.service';
import { signedUrl } from './mobile.storage';

const manager1 = { userId: 'm1', role: 'MANAGER', permissions: [] };
const manager2 = { userId: 'm2', role: 'MANAGER', permissions: [] };
const rop = { userId: 'r1', role: 'MANAGER', permissions: ['use_rop_agent'] };
const director = { userId: 'd1', role: 'SUPER_ADMIN', permissions: [] };

async function addCall(over: Record<string, unknown>) {
  return state.fake.prisma.callSession.create({
    data: {
      provider: 'MOBILE',
      externalCallId: `mobile:${Math.random()}`,
      direction: 'INBOUND',
      status: 'COMPLETED',
      mobileType: 'in',
      durationSec: 60,
      startedAt: new Date('2026-10-03T09:00:00Z'),
      phone: '+998901234567',
      phoneKey: '901234567',
      recordingPath: 'm1/2026/10/rec.m4a',
      ...over,
    },
  });
}

beforeEach(() => {
  state.fake = createFakePrisma();
  vi.mocked(signedUrl).mockClear();
});

describe('доступ к звонкам', () => {
  it('менеджер не видит чужой звонок', async () => {
    const foreign = await addCall({ managerUserId: 'm2' });
    await expect(getCall(manager1, foreign.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('менеджер не получает signed URL чужой записи', async () => {
    const foreign = await addCall({ managerUserId: 'm2' });
    await expect(getAudioUrl(manager1, foreign.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('свою запись менеджер слушает по signed URL на час', async () => {
    const own = await addCall({ managerUserId: 'm1' });
    await expect(getAudioUrl(manager1, own.id)).resolves.toEqual({ url: 'https://storage.test/signed/m1/2026/10/rec.m4a', expiresInSec: 3600 });
    expect(signedUrl).toHaveBeenCalledWith('m1/2026/10/rec.m4a', 3600);
  });

  it('запись уже только на Google Drive — ссылка на поток с токеном для этого звонка', async () => {
    const own = await addCall({ managerUserId: 'm1', recordingPath: null, driveFileId: 'drive-1' });
    const { url } = await getAudioUrl(manager1, own.id, 'https://api.test');
    expect(url.startsWith(`https://api.test/api/calls/${own.id}/audio-stream?t=`)).toBe(true);
    const token = decodeURIComponent(new URL(url).searchParams.get('t')!);
    expect(() => verifyAudioStreamToken(token, own.id)).not.toThrow();
    // Токен одного звонка не открывает другой
    const other = await addCall({ managerUserId: 'm2', recordingPath: null, driveFileId: 'drive-2' });
    expect(() => verifyAudioStreamToken(token, other.id)).toThrow();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('чужую запись с Drive менеджер тоже не получает', async () => {
    const foreign = await addCall({ managerUserId: 'm2', recordingPath: null, driveFileId: 'drive-1' });
    await expect(getAudioUrl(manager1, foreign.id, 'https://api.test')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('РОП (use_rop_agent) и директор видят звонки всех менеджеров', async () => {
    const c = await addCall({ managerUserId: 'm2' });
    await expect(getAudioUrl(rop, c.id)).resolves.toMatchObject({ expiresInSec: 3600 });
    await expect(getCall(director, c.id)).resolves.toMatchObject({ id: c.id });
  });

  it('в журнале менеджер видит только свои звонки, фильтр по менеджеру ему не помогает', async () => {
    await addCall({ managerUserId: 'm1' });
    await addCall({ managerUserId: 'm2' });
    const own = await listCalls(manager1, { page: 1, pageSize: 30, managerId: 'm2' });
    expect(own.items.map((i: any) => i.id)).toHaveLength(1);
    expect(own.totalCount).toBe(1);
    const all = await listCalls(director, { page: 1, pageSize: 30 });
    expect(all.totalCount).toBe(2);
  });

  it('чужой звонок нельзя привязать к клиенту и отметить «Перезвонил»', async () => {
    const foreign = await addCall({ managerUserId: 'm2' });
    state.fake.db.client.push({ id: 'c1', phone: null, isArchived: false });
    await expect(linkClient(manager1, foreign.id, 'c1')).rejects.toMatchObject({ statusCode: 404 });
    await expect(markCalledBack(manager1, foreign.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(getCall(manager2, foreign.id)).resolves.toMatchObject({ id: foreign.id });
  });
});

describe('привязка номера к клиенту', () => {
  it('перепривязывает все звонки с этим номером без клиента и предлагает записать номер', async () => {
    const a = await addCall({ managerUserId: 'm1' });
    await addCall({ managerUserId: 'm2', phone: '+998901234567' });
    await addCall({ managerUserId: 'm1', clientId: 'other' });
    state.fake.db.client.push({ id: 'c1', phone: '', isArchived: false });

    const res = await linkClient(manager1, a.id, 'c1');
    expect(res).toMatchObject({ linkedCount: 2, suggestSavePhone: true, phoneSaved: false, phone: '+998 90 123 45 67' });
    expect(state.fake.db.callSession.map((c: any) => c.clientId)).toEqual(['c1', 'c1', 'other']);

    const saved = await linkClient(manager1, a.id, 'c1', true);
    expect(saved.phoneSaved).toBe(true);
    expect(state.fake.db.client[0].phone).toBe('+998 90 123 45 67');
  });
});
