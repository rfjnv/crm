import { createHash } from 'crypto';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

/**
 * Долговременная память РОП-агента: решения и договорённости директора, которые
 * должны действовать во всех разговорах («фольгу не демпингуем», «Акмал в отпуске
 * до 10-го», «Print House платит в конце месяца»). Одна на всех, кто работает с
 * агентом: директор и администратор говорят с одним и тем же сотрудником.
 *
 * В разговор память попадает текстом в начале реплики пользователя — и только когда
 * она изменилась с прошлой передачи в этот чат. Системный промпт при этом не меняется,
 * история остаётся дописываемой.
 */

export type MemoryItem = {
  id: string;
  content: string;
  expiresAt: Date | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { fullName: string };
};

const MAX_MEMORY_CHARS = 500;
const MAX_ACTIVE_MEMORIES = 100;

/** Действующая память: без срока или срок ещё не наступил. */
export function activeMemories(): Promise<MemoryItem[]> {
  return prisma.ropAgentMemory.findMany({
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: 'asc' },
    take: MAX_ACTIVE_MEMORIES,
    select: { id: true, content: true, expiresAt: true, source: true, createdAt: true, updatedAt: true, createdBy: { select: { fullName: true } } },
  });
}

/** Отпечаток набора — по нему видно, что память изменилась с прошлой передачи. */
export function memoryHash(items: MemoryItem[]): string {
  const h = createHash('sha1');
  for (const m of items) h.update(`${m.id}|${m.updatedAt.toISOString()}|${m.expiresAt?.toISOString() ?? ''};`);
  return h.digest('hex');
}

const shortId = (id: string) => id.slice(0, 8);
const ddmm = (d: Date) => {
  const t = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  return `${String(t.getUTCDate()).padStart(2, '0')}.${String(t.getUTCMonth() + 1).padStart(2, '0')}.${t.getUTCFullYear()}`;
};

/** Текст памяти для модели (в реплику чата, в сводку, в сигналы). */
export function memoryText(items: MemoryItem[]): string {
  if (!items.length) return 'Память пуста: договорённостей пока нет.';
  return items
    .map((m) => `- [${shortId(m.id)}] ${m.content}${m.expiresAt ? ` (действует до ${ddmm(m.expiresAt)})` : ''} — ${m.createdBy.fullName}, ${ddmm(m.createdAt)}`)
    .join('\n');
}

function parseExpiry(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) throw new AppError(400, 'Срок в формате YYYY-MM-DD');
  // Действует до конца указанного дня по Ташкенту.
  const d = new Date(`${raw.trim()}T23:59:59+05:00`);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'Неверная дата срока');
  return d;
}

function cleanContent(raw: unknown): string {
  const content = typeof raw === 'string' ? raw.trim() : '';
  if (!content) throw new AppError(400, 'Пустая запись');
  if (content.length > MAX_MEMORY_CHARS) throw new AppError(400, `Запись длиннее ${MAX_MEMORY_CHARS} символов — сформулируйте короче`);
  return content;
}

// ─── Инструменты агента ─────────────────────────────────────────────────────

export async function rememberTool(ctx: { userId: string }, input: { content?: unknown; expires_on?: unknown }) {
  const m = await prisma.ropAgentMemory.create({
    data: { content: cleanContent(input.content), expiresAt: parseExpiry(input.expires_on), createdById: ctx.userId, source: 'agent' },
  });
  return { memory_id: shortId(m.id), saved: m.content, expires_at: m.expiresAt ? ddmm(m.expiresAt) : null };
}

/** Забыть по короткому id из текста памяти (первые 8 символов). */
export async function forgetTool(input: { memory_id?: unknown }) {
  const id = typeof input.memory_id === 'string' ? input.memory_id.trim().replace(/^\[|\]$/g, '') : '';
  if (id.length < 8) throw new AppError(400, 'Нужен id записи из памяти (8 символов в квадратных скобках)');
  const found = await prisma.ropAgentMemory.findMany({ where: { id: { startsWith: id } }, select: { id: true, content: true } });
  if (found.length !== 1) throw new AppError(404, 'Запись не найдена');
  await prisma.ropAgentMemory.delete({ where: { id: found[0].id } });
  return { forgotten: found[0].content };
}

// ─── Страница ───────────────────────────────────────────────────────────────

export function listMemories() {
  return prisma.ropAgentMemory.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, content: true, expiresAt: true, source: true, createdAt: true, updatedAt: true, createdBy: { select: { fullName: true } } },
  });
}

export function addMemory(userId: string, data: { content: string; expiresOn?: string | null }) {
  return prisma.ropAgentMemory.create({
    data: { content: cleanContent(data.content), expiresAt: parseExpiry(data.expiresOn), createdById: userId, source: 'user' },
  });
}

export async function updateMemory(id: string, data: { content?: string; expiresOn?: string | null }) {
  const exists = await prisma.ropAgentMemory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AppError(404, 'Запись не найдена');
  return prisma.ropAgentMemory.update({
    where: { id },
    data: {
      ...(data.content !== undefined ? { content: cleanContent(data.content) } : {}),
      ...(data.expiresOn !== undefined ? { expiresAt: parseExpiry(data.expiresOn) } : {}),
    },
  });
}

export async function deleteMemory(id: string) {
  const exists = await prisma.ropAgentMemory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AppError(404, 'Запись не найдена');
  await prisma.ropAgentMemory.delete({ where: { id } });
}
