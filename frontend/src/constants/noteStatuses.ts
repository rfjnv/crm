export const BASE_NOTE_STATUSES = ['Успешный', 'Н/А', 'Пока думает', 'Дал запрос'] as const;

export const NOTE_STATUS_COLORS: Record<string, string> = {
  'Успешный': 'green',
  'Н/А': 'default',
  'Пока думает': 'gold',
  'Дал запрос': 'blue',
};

export function noteStatusColor(name?: string | null): string {
  const v = (name || '').trim();
  if (!v) return 'default';
  if (NOTE_STATUS_COLORS[v]) return NOTE_STATUS_COLORS[v];
  const palette = ['magenta', 'purple', 'cyan', 'orange', 'lime', 'geekblue'];
  let hash = 0;
  for (let i = 0; i < v.length; i += 1) hash = (hash * 31 + v.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function normalizeNoteStatusField(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const s = v[0];
    return typeof s === 'string' ? s.trim() || undefined : undefined;
  }
  if (typeof v === 'string') return v.trim() || undefined;
  return undefined;
}
