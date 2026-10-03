import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../../lib/supabase';
import { isSupabaseConfigured } from '../../lib/config';
import { AppError } from '../../lib/errors';

/**
 * Записи разговоров и логи приложения — в приватном bucket Supabase: у Render free нет
 * постоянного диска. Публичных ссылок нет, прослушивание — по signed URL на час.
 */
export const CALL_BUCKET = 'call-recordings';

function bucket() {
  if (!isSupabaseConfigured) {
    throw new AppError(503, 'Хранилище записей не настроено (Supabase)');
  }
  return getSupabaseAdmin().storage.from(CALL_BUCKET);
}

const AUDIO_MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  amr: 'audio/amr',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  '3gp': 'audio/3gpp',
  '3gpp': 'audio/3gpp',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

/** Расширение из имени файла (приложение присылает «recording.<ext>»). */
export function audioExt(fileName: string | null | undefined): string {
  const ext = (fileName ?? '').match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase();
  return ext ?? 'bin';
}

export function audioMime(ext: string): string {
  return AUDIO_MIME[ext] ?? 'application/octet-stream';
}

export async function uploadFile(objectPath: string, localPath: string, contentType: string): Promise<void> {
  const body = await fs.readFile(localPath);
  const { error } = await bucket().upload(objectPath, body, { contentType, upsert: false });
  if (error) throw new AppError(502, `Не удалось сохранить файл: ${error.message}`);
}

export async function signedUrl(objectPath: string, expiresInSec = 3600): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(objectPath, expiresInSec);
  if (error || !data?.signedUrl) throw new AppError(502, `Не удалось получить ссылку на файл: ${error?.message ?? 'нет ответа'}`);
  return data.signedUrl;
}

/** Скачивает файл во временную папку. Удалять вызывающему. */
export async function downloadToTemp(objectPath: string): Promise<string> {
  const { data, error } = await bucket().download(objectPath);
  if (error || !data) throw new Error(`Не удалось скачать запись: ${error?.message ?? 'нет данных'}`);
  const local = path.join(os.tmpdir(), `callsync-${randomUUID()}.${audioExt(objectPath)}`);
  await fs.writeFile(local, Buffer.from(await data.arrayBuffer()));
  return local;
}

export async function removeFiles(objectPaths: string[]): Promise<void> {
  if (objectPaths.length === 0) return;
  const { error } = await bucket().remove(objectPaths);
  if (error) throw new Error(`Не удалось удалить файлы: ${error.message}`);
}
