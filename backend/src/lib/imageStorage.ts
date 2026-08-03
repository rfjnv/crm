import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from './supabase';
import { isSupabaseConfigured } from './config';
import { AppError } from './errors';

const BUCKET = 'images';

/**
 * Загружает картинку в Supabase Storage — Render не даёт persistent disk на free
 * плане, поэтому файлы на локальном диске бэкенда пропадают при каждом деплое/рестарте.
 */
export async function uploadImageToStorage(file: Express.Multer.File, folder: string): Promise<string> {
  if (!isSupabaseConfigured) {
    throw new AppError(500, 'Хранилище изображений не настроено (Supabase)');
  }
  const sb = getSupabaseAdmin();
  const ext = (file.originalname.match(/\.[a-zA-Z0-9]+$/)?.[0] || '.jpg').toLowerCase();
  const objectPath = `${folder}/${randomUUID()}${ext}`;

  const { error } = await sb.storage.from(BUCKET).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new AppError(400, error.message);

  const { data } = sb.storage.from(BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

/** Удаляет файл из Supabase Storage по его публичному URL. Тихо игнорирует чужие/битые URL. */
export async function deleteImageFromStorage(publicUrl: string | null | undefined): Promise<void> {
  if (!publicUrl || !isSupabaseConfigured) return;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const objectPath = publicUrl.slice(idx + marker.length);
  const sb = getSupabaseAdmin();
  await sb.storage.from(BUCKET).remove([objectPath]);
}
