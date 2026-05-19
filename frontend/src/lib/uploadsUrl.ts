/** Публичный URL файла из папки uploads (логотипы поставщиков и т.д.). */
export function uploadsUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }
  const origin = import.meta.env.VITE_API_URL
    ? new URL(import.meta.env.VITE_API_URL).origin
    : '';
  const rel = normalized.includes('uploads/')
    ? normalized.slice(normalized.indexOf('uploads/'))
    : normalized.replace(/^\//, '');
  return `${origin}/${rel}`;
}
