import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { publicServerUrl } from './mobile.public-url';

/**
 * Google Drive как бесплатный архив записей звонков. Подключение — кнопкой в CRM (OAuth),
 * refresh token хранится в БД: сменить аккаунт (личный → компании) можно без деплоя.
 * Scope drive.file: CRM видит только файлы и папки, которые создала сама, — чужие файлы
 * на этом Drive ей недоступны.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DRIVE_ROOT_FOLDER_NAME = 'CallSync — записи звонков';

export function isDriveConfigured(): boolean {
  return !!(config.googleDrive.clientId && config.googleDrive.clientSecret);
}

export function driveRedirectUri(fallbackServer: string): string {
  return `${publicServerUrl(fallbackServer)}/api/mobile/drive/callback`;
}

// ─── OAuth ──────────────────────────────────────────────────────────────────

const STATE_PURPOSE = 'google-drive-connect';

export function driveAuthUrl(userId: string, fallbackServer: string): string {
  if (!isDriveConfigured()) {
    throw new AppError(503, 'Не заданы GOOGLE_DRIVE_CLIENT_ID и GOOGLE_DRIVE_CLIENT_SECRET на сервере');
  }
  // state подписан: callback приходит без токена CRM, по state понимаем, кто подключал, и отсекаем подделку
  const state = jwt.sign({ userId, purpose: STATE_PURPOSE }, config.jwt.accessSecret, { expiresIn: '15m' });
  const params = new URLSearchParams({
    client_id: config.googleDrive.clientId,
    redirect_uri: driveRedirectUri(fallbackServer),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Без prompt=consent Google не выдаёт refresh token повторно
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export function verifyDriveState(state: string): string {
  try {
    const payload = jwt.verify(state, config.jwt.accessSecret) as { userId?: string; purpose?: string };
    if (payload.purpose !== STATE_PURPOSE || !payload.userId) throw new Error('purpose');
    return payload.userId;
  } catch {
    throw new AppError(400, 'Ссылка подключения устарела — начните заново');
  }
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.googleDrive.clientId, client_secret: config.googleDrive.clientSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; error?: string; error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const err = new Error(json.error_description || json.error || `Google token ${res.status}`) as Error & { code?: string };
    err.code = json.error;
    throw err;
  }
  return json;
}

/** Email из id_token: он пришёл напрямую от Google по TLS, подпись не проверяем. */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

let accessCache: { token: string; expiresAt: number; refreshToken: string } | null = null;

export async function connectDrive(code: string, userId: string, fallbackServer: string): Promise<string | null> {
  const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: driveRedirectUri(fallbackServer) });
  if (!tokens.refresh_token) throw new AppError(400, 'Google не выдал постоянный доступ. Отключите доступ CRM в настройках Google-аккаунта и подключите снова.');
  const email = emailFromIdToken(tokens.id_token);
  await prisma.googleDriveConnection.upsert({
    where: { id: 'singleton' },
    // Другой аккаунт — другие папки: корневую папку ищем/создаём заново
    create: { id: 'singleton', refreshToken: tokens.refresh_token, accountEmail: email, connectedAt: new Date(), connectedById: userId },
    update: { refreshToken: tokens.refresh_token, accountEmail: email, connectedAt: new Date(), connectedById: userId, rootFolderId: null, lastError: null, lastErrorAt: null },
  });
  accessCache = { token: tokens.access_token!, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000, refreshToken: tokens.refresh_token };
  folderCache.clear();
  return email;
}

export async function disconnectDrive(): Promise<void> {
  const row = await prisma.googleDriveConnection.findUnique({ where: { id: 'singleton' } });
  if (row?.refreshToken) {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(row.refreshToken)}`, { method: 'POST' }).catch(() => {});
  }
  await prisma.googleDriveConnection.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: { refreshToken: null, accountEmail: null, rootFolderId: null, connectedAt: null, lastError: null, lastErrorAt: null },
  });
  accessCache = null;
  folderCache.clear();
}

export async function getDriveConnection() {
  return prisma.googleDriveConnection.findUnique({ where: { id: 'singleton' } });
}

export async function recordDriveError(message: string): Promise<void> {
  await prisma.googleDriveConnection.updateMany({ where: { id: 'singleton' }, data: { lastError: message.slice(0, 500), lastErrorAt: new Date() } });
}

/** Подключён ли Drive и можно ли с ним работать. */
export async function isDriveConnected(): Promise<boolean> {
  if (!isDriveConfigured()) return false;
  const row = await getDriveConnection();
  return !!row?.refreshToken;
}

async function accessToken(): Promise<string> {
  const row = await getDriveConnection();
  if (!row?.refreshToken) throw new AppError(503, 'Google Drive не подключён');
  if (accessCache && accessCache.refreshToken === row.refreshToken && accessCache.expiresAt - 60_000 > Date.now()) {
    return accessCache.token;
  }
  try {
    const t = await tokenRequest({ refresh_token: row.refreshToken, grant_type: 'refresh_token' });
    accessCache = { token: t.access_token!, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000, refreshToken: row.refreshToken };
    return t.access_token!;
  } catch (err) {
    if ((err as { code?: string }).code === 'invalid_grant') {
      await recordDriveError('Google отозвал доступ (сменили пароль, отключили доступ или приложение в режиме Testing). Подключите Google Drive заново.');
    }
    throw err;
  }
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
}

async function driveJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await driveFetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Google Drive ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// ─── Папки ──────────────────────────────────────────────────────────────────

const folderCache = new Map<string, string>();

function escapeQuery(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findOrCreateFolder(name: string, parentId: string | null): Promise<string> {
  const key = `${parentId ?? 'root'}/${name}`;
  const cached = folderCache.get(key);
  if (cached) return cached;
  const q = [`name = '${escapeQuery(name)}'`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false', `'${parentId ?? 'root'}' in parents`].join(' and ');
  const found = await driveJson<{ files: { id: string }[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive', pageSize: '1' })}`);
  let id = found.files[0]?.id;
  if (!id) {
    const created = await driveJson<{ id: string }>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
    });
    id = created.id;
  }
  folderCache.set(key, id);
  return id;
}

async function rootFolderId(): Promise<string> {
  const row = await getDriveConnection();
  if (row?.rootFolderId) return row.rootFolderId;
  const id = await findOrCreateFolder(DRIVE_ROOT_FOLDER_NAME, null);
  await prisma.googleDriveConnection.update({ where: { id: 'singleton' }, data: { rootFolderId: id } });
  return id;
}

/** Папка по пути внутри корневой: ['Дилноза Каримова', '2026-10']. */
export async function ensureFolderPath(segments: string[]): Promise<string> {
  let parent = await rootFolderId();
  for (const segment of segments) parent = await findOrCreateFolder(segment, parent);
  return parent;
}

/** Корневую папку удалили руками на Drive — забываем её, при следующей загрузке создастся новая. */
export async function resetFolders(): Promise<void> {
  folderCache.clear();
  await prisma.googleDriveConnection.updateMany({ where: { id: 'singleton' }, data: { rootFolderId: null } });
}

// ─── Файлы ──────────────────────────────────────────────────────────────────

/** Загрузка файла (resumable — записи бывают до 50 МБ). Возвращает id файла на Drive. */
export async function uploadToDrive(localPath: string, name: string, mimeType: string, folderId: string): Promise<string> {
  const body = await fs.readFile(localPath);
  const init = await driveFetch(`${UPLOAD_API}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': mimeType,
      'x-upload-content-length': String(body.length),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const location = init.headers.get('location');
  if (!init.ok || !location) {
    const err = new Error(`Google Drive ${init.status}: ${(await init.text().catch(() => '')).slice(0, 300)}`) as Error & { status?: number };
    err.status = init.status;
    throw err;
  }
  const res = await fetch(location, { method: 'PUT', headers: { 'content-type': mimeType, 'content-length': String(body.length) }, body });
  if (!res.ok) throw new Error(`Google Drive upload ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const file = (await res.json()) as { id: string };
  return file.id;
}

/** Содержимое файла для прослушивания; Range пробрасывается, чтобы работала перемотка. */
export async function downloadFromDrive(fileId: string, range?: string): Promise<Response> {
  return driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: range ? { range } : {} });
}

export async function downloadDriveToFile(fileId: string, localPath: string): Promise<void> {
  const res = await downloadFromDrive(fileId);
  if (!res.ok) throw new Error(`Google Drive ${res.status}: не удалось скачать запись`);
  await fs.writeFile(localPath, Buffer.from(await res.arrayBuffer()));
}

export async function deleteFromDrive(fileId: string): Promise<void> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  // Уже удалён руками — для нас это тоже успех
  if (!res.ok && res.status !== 404) throw new Error(`Google Drive ${res.status}: не удалось удалить файл`);
}
