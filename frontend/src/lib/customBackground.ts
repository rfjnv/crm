/**
 * Свой фон для стеклянного дизайна.
 *
 * Хранится в IndexedDB этого браузера: у каждого устройства свой фон, на сервер
 * ничего не уходит. localStorage не подходит — фото в base64 быстро упирается в
 * его лимит. Если хранилище недоступно (приватный режим, iframe Telegram),
 * фон живёт до перезагрузки, а приложение работает как обычно.
 */

const DB_NAME = 'crm-ui';
const STORE = 'kv';
const KEY = 'glass-bg';

/** Длинная сторона после сжатия: хватает на 4K-экран с учётом размытия стекла. */
const MAX_SIDE = 2560;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

let memoryFallback: Blob | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadCustomBackground(): Promise<Blob | null> {
  try {
    const value = await withStore<unknown>('readonly', (s) => s.get(KEY));
    return value instanceof Blob ? value : null;
  } catch {
    return memoryFallback;
  }
}

export async function saveCustomBackground(blob: Blob): Promise<void> {
  memoryFallback = blob;
  try {
    await withStore('readwrite', (s) => s.put(blob, KEY));
  } catch {
    // Остаётся в памяти до перезагрузки
  }
}

export async function clearCustomBackground(): Promise<void> {
  memoryFallback = null;
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    // Нечего чистить
  }
}

/**
 * Уменьшает фото до разумного размера и пережимает в WebP (или JPEG, если
 * браузер не умеет WebP). Снимок с телефона весит 5–15 МБ — хранить и
 * отрисовывать его целиком незачем, под стеклом он всё равно размыт.
 */
export async function prepareBackground(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    const webp = await encode('image/webp');
    if (webp && webp.type === 'image/webp') return webp;
    return (await encode('image/jpeg')) ?? file;
  } finally {
    bitmap.close();
  }
}
