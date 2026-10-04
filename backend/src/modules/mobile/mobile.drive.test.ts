import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  connection: null as Record<string, unknown> | null,
}));

vi.mock('../../lib/prisma', () => ({
  default: {
    googleDriveConnection: {
      findUnique: vi.fn(async () => state.connection),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.connection!, data)),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.connection) Object.assign(state.connection, data);
        return { count: state.connection ? 1 : 0 };
      }),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        state.connection = state.connection ? Object.assign(state.connection, update) : { ...create };
        return state.connection;
      }),
    },
  },
}));
vi.mock('../../lib/config', () => ({
  config: {
    googleDrive: { clientId: 'cid', clientSecret: 'secret' },
    jwt: { accessSecret: 'test-secret' },
    mobile: { publicServerUrl: 'https://api.example.uz' },
  },
}));

import { archiveLocation, safeDriveName } from './mobile.archive';
import { connectDrive, driveAuthUrl, ensureFolderPath, resetFolders, uploadToDrive, verifyDriveState } from './mobile.drive';

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let tmp: string;

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

beforeEach(async () => {
  calls = [];
  state.connection = { id: 'singleton', refreshToken: 'rt-1', rootFolderId: null };
  await resetFolders();
  tmp = path.join(os.tmpdir(), `drive-test-${Date.now()}.m4a`);
  await fs.writeFile(tmp, Buffer.from('audio'));
  let folderSeq = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'at-1', expires_in: 3600 });
    if (url.includes('/drive/v3/files?q=')) return json({ files: [] });
    if (url.includes('/drive/v3/files?fields=id')) return json({ id: `folder-${++folderSeq}` });
    if (url.includes('uploadType=resumable')) return new Response(null, { status: 200, headers: { location: 'https://upload.example/session-1' } });
    if (url === 'https://upload.example/session-1') return json({ id: 'file-42' });
    throw new Error(`unexpected fetch ${url}`);
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.unlink(tmp).catch(() => {});
});

describe('Google Drive: подключение', () => {
  it('ссылка входа просит только drive.file и постоянный доступ, state подписан', () => {
    const url = new URL(driveAuthUrl('user-1', 'http://ignored'));
    expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.uz/api/mobile/drive/callback');
    expect(verifyDriveState(url.searchParams.get('state')!)).toBe('user-1');
    expect(() => verifyDriveState('подделка')).toThrow();
  });

  it('после входа сохраняет refresh token и email аккаунта', async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'owner@gmail.com' })).toString('base64url')}.y`;
    vi.mocked(fetch).mockImplementationOnce(async () => json({ access_token: 'at', refresh_token: 'rt-new', id_token: idToken, expires_in: 3600 }));
    state.connection = { id: 'singleton', refreshToken: 'old', rootFolderId: 'old-root' };
    await expect(connectDrive('code-1', 'user-1', '')).resolves.toBe('owner@gmail.com');
    expect(state.connection).toMatchObject({ refreshToken: 'rt-new', accountEmail: 'owner@gmail.com', rootFolderId: null, connectedById: 'user-1' });
  });
});

describe('Google Drive: загрузка', () => {
  it('создаёт папки по пути один раз и загружает файл через resumable upload', async () => {
    const folder = await ensureFolderPath(['Дилноза Каримова', '2026-10']);
    expect(folder).toBe('folder-3');
    expect(state.connection!.rootFolderId).toBe('folder-1');
    await ensureFolderPath(['Дилноза Каримова', '2026-10']);
    expect(calls.filter((c) => c.url.includes('/drive/v3/files?fields=id'))).toHaveLength(3);

    const id = await uploadToDrive(tmp, 'звонок.m4a', 'audio/mp4', folder);
    expect(id).toBe('file-42');
    const init = calls.find((c) => c.url.includes('uploadType=resumable'))!;
    expect(JSON.parse(String(init.init!.body))).toEqual({ name: 'звонок.m4a', parents: ['folder-3'] });
    expect((init.init!.headers as Record<string, string>).authorization).toBe('Bearer at-1');
    const put = calls.find((c) => c.url === 'https://upload.example/session-1')!;
    expect(put.init!.method).toBe('PUT');
  });

  it('без подключения — понятная ошибка, а не обращение к Google', async () => {
    state.connection = { id: 'singleton', refreshToken: null };
    await expect(ensureFolderPath(['x'])).rejects.toMatchObject({ statusCode: 503 });
    expect(calls).toHaveLength(0);
  });
});

describe('имена файлов в архиве', () => {
  it('звонок: папка менеджера и месяца, в имени время по Ташкенту, тип, номер и клиент', () => {
    expect(archiveLocation({
      managerName: 'Дилноза Каримова',
      ext: 'm4a',
      fileName: 'recording.m4a',
      createdAt: new Date('2026-10-03T09:30:00Z'),
      call: { startedAt: new Date('2026-10-03T09:25:30Z'), mobileType: 'in', phone: '+998901234567', clientName: 'Print House' },
    })).toEqual({
      folders: ['Дилноза Каримова', '2026-10'],
      name: '2026-10-03 14-25 Входящий +998 90 123 45 67 Print House.m4a',
    });
  });

  it('запись без звонка — в «Без звонка» под исходным именем', () => {
    expect(archiveLocation({
      managerName: 'Фарход',
      ext: 'amr',
      fileName: 'Call@Шерзод (998901234567)_20261003.amr',
      createdAt: new Date('2026-10-31T20:00:00Z'),
      call: null,
    })).toEqual({ folders: ['Фарход', '2026-11', 'Без звонка'], name: 'Call@Шерзод (998901234567)_20261003.amr' });
  });

  it('запрещённые символы убираются', () => {
    expect(safeDriveName('ООО "Print/House": филиал*1')).toBe('ООО Print House филиал 1');
    expect(safeDriveName('   ')).toBe('без названия');
  });
});
