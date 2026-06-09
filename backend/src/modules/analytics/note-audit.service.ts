import Anthropic from '@anthropic-ai/sdk';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';

// ─── Claude client ───────────────────────────────────────────────────────────

function getClaudeClient(): Anthropic {
  const apiKey = config.claude.apiKey;
  if (!apiKey) throw new AppError(500, 'CLAUDE_API_KEY не настроен. Обратитесь к администратору.');
  return new Anthropic({ apiKey });
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────

const TZ_OFFSET = 5 * 60 * 60 * 1000; // Asia/Tashkent = UTC+5

function toTashkentDate(utc: Date): Date {
  return new Date(utc.getTime() + TZ_OFFSET);
}

function fmtDate(d: Date): string {
  const t = toTashkentDate(d);
  return `${String(t.getUTCDate()).padStart(2, '0')}.${String(t.getUTCMonth() + 1).padStart(2, '0')}.${t.getUTCFullYear()}`;
}

/** Start of Tashkent Monday for the given week offset (0 = current, -1 = last week). */
export function tashkentWeekRange(weekOffset = -1): { start: Date; end: Date } {
  const nowTz = new Date(Date.now() + TZ_OFFSET);
  const dow = nowTz.getUTCDay(); // 0=Sun
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const thisMondayUtc = new Date(
    Date.UTC(nowTz.getUTCFullYear(), nowTz.getUTCMonth(), nowTz.getUTCDate()) -
      TZ_OFFSET -
      daysFromMon * 86400000,
  );
  const shift = weekOffset * 7 * 86400000;
  return {
    start: new Date(thisMondayUtc.getTime() + shift),
    end: new Date(thisMondayUtc.getTime() + shift + 7 * 86400000),
  };
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — эксперт по качеству работы менеджеров отдела продаж компании Polygraph Business (Узбекистан, полиграфическая промышленность — расходные материалы для печати).

Твоя задача: проанализировать заметки менеджера за неделю и дать структурированную оценку его работы с клиентами.

━━━ КОНТЕКСТ ━━━
• Менеджеры пишут заметки о звонках/встречах с клиентами прямо в CRM
• Язык — русский и узбекский вперемешку, транслит, сокращения, неформальный стиль — это НОРМА
• Два типа заметок:
  1. Перенесённые из общего журнала (короче, результат звонка)
  2. Написанные вручную на карточке клиента (подробнее, личнее)
• Типичные слова: "не берёт", "перезвонит", "kelishib oldik", "отправил прайс", "ждём оплату"

━━━ КРИТЕРИИ (каждый 1–10) ━━━

КОНКРЕТНОСТЬ (scoreSpecificity)
  1–3 → только "позвонил/написал/не берёт" без деталей
  4–6 → есть базовая информация, но неполная
  7–10 → конкретика: что обсудили, какой товар, потребность, договорённость
  ★ Короткое "оплатил, доволен" для постоянного клиента → 7+ (краткость в порядке)

НЕДОЗВОНЫ (scoreFollowUp)
  1–3 → клиент не берёт — менеджер больше не возвращается к нему
  4–6 → иногда повторно пробует связаться
  7–10 → фиксирует "не берёт" и потом обязательно отмечает результат повторного звонка
  ★ Если в периоде недозвонов нет совсем → ставь 7.0 (нейтрально)

СЛЕДУЮЩИЙ ШАГ (scoreNextStep)
  1–3 → после контакта нет никакого плана действий
  4–6 → иногда намекает что будет дальше
  7–10 → после каждого контакта виден конкретный шаг ("отправлю КП сегодня", "жду оплату 15-го", "перезвоню в четверг")

ТОН (scoreTone)
  1–3 → раздражение: "вечно не берёт", "опять ноет", "достал уже"
  4–6 → нейтральный
  7–10 → профессиональный, уважительный, ориентирован на помощь клиенту

━━━ ПРАВИЛА ━━━
• Оценивай паттерн ВСЕЙ недели, не отдельные заметки
• НЕ штрафуй за смешанный язык — это стандарт команды
• scoreOverall = round(specificity×0.30 + followUp×0.20 + nextStep×0.30 + tone×0.20, 1)
• goodExamples / badExamples → цитируй РЕАЛЬНЫЕ заметки из входных данных (не придумывай)
• Если заметок мало (<5) — укажи это в summary

━━━ ФОРМАТ ━━━
Верни ТОЛЬКО валидный JSON (без markdown-блоков \`\`\`json):
{
  "scoreSpecificity": 7.5,
  "scoreFollowUp": 6.0,
  "scoreNextStep": 5.5,
  "scoreTone": 8.0,
  "scoreOverall": 6.8,
  "summary": "2-3 предложения: общее впечатление от работы менеджера за неделю",
  "feedbackSpecificity": "Конкретная обратная связь (2-4 предложения)",
  "feedbackFollowUp": "Обратная связь по недозвонам (2-4 предложения)",
  "feedbackNextStep": "Обратная связь по планированию (2-4 предложения)",
  "feedbackTone": "Обратная связь по тону (2-4 предложения)",
  "goodExamples": ["цитата 1", "цитата 2"],
  "badExamples": ["цитата которая могла быть лучше 1", "цитата 2"]
}`;

function buildUserPrompt(params: {
  managerName: string;
  periodLabel: string;
  notes: { clientName: string; createdAt: Date; content: string }[];
  memories: string[];
}): string {
  const { managerName, periodLabel, notes, memories } = params;

  const notesText = notes
    .map((n) => {
      const t = toTashkentDate(n.createdAt);
      const dateStr = `${String(t.getUTCDate()).padStart(2, '0')}.${String(t.getUTCMonth() + 1).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
      return `[${dateStr}] ${n.clientName}\n${n.content}`;
    })
    .join('\n\n');

  const memoriesSection =
    memories.length > 0
      ? `\n\n━━━ ПРОШЛЫЕ КОРРЕКТИРОВКИ АДМИНИСТРАТОРА (учти при оценке) ━━━\n${memories.join('\n\n')}`
      : '';

  return `МЕНЕДЖЕР: ${managerName}
ПЕРИОД: ${periodLabel}
ЗАМЕТОК: ${notes.length}${memoriesSection}

━━━ ЗАМЕТКИ ━━━

${notesText}`;
}

// ─── Core analysis ────────────────────────────────────────────────────────────

export interface NoteAuditAiResult {
  scoreSpecificity: number;
  scoreFollowUp: number;
  scoreNextStep: number;
  scoreTone: number;
  scoreOverall: number;
  summary: string;
  feedbackSpecificity: string;
  feedbackFollowUp: string;
  feedbackNextStep: string;
  feedbackTone: string;
  goodExamples: string[];
  badExamples: string[];
}

async function runAiAnalysis(params: {
  managerId: string;
  managerName: string;
  start: Date;
  end: Date;
}): Promise<{ result: NoteAuditAiResult; notesCount: number }> {
  const { managerId, managerName, start, end } = params;

  const notes = await prisma.clientNote.findMany({
    where: { userId: managerId, deletedAt: null, createdAt: { gte: start, lt: end } },
    select: {
      content: true,
      createdAt: true,
      client: { select: { companyName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (notes.length === 0) {
    return {
      result: {
        scoreSpecificity: 0,
        scoreFollowUp: 0,
        scoreNextStep: 0,
        scoreTone: 0,
        scoreOverall: 0,
        summary: 'За указанный период заметок не найдено.',
        feedbackSpecificity: 'Нет данных для анализа.',
        feedbackFollowUp: 'Нет данных для анализа.',
        feedbackNextStep: 'Нет данных для анализа.',
        feedbackTone: 'Нет данных для анализа.',
        goodExamples: [],
        badExamples: [],
      },
      notesCount: 0,
    };
  }

  // Fetch stored memories (manager-specific + global)
  const memories = await prisma.noteAuditMemory.findMany({
    where: { managerId: { in: [managerId, '*'] } },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { context: true },
  });

  const periodLabel = `${fmtDate(start)} — ${fmtDate(new Date(end.getTime() - 1))}`;

  const userPrompt = buildUserPrompt({
    managerName,
    periodLabel,
    notes: notes.map((n) => ({
      clientName: n.client.companyName,
      createdAt: n.createdAt,
      content: n.content,
    })),
    memories: memories.map((m) => m.context),
  });

  const claude = getClaudeClient();
  const completion = await claude.messages.create({
    model: config.claude.model,
    temperature: 0.1,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = completion.content[0].type === 'text' ? completion.content[0].text : '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude вернул невалидный ответ (нет JSON)');

  const parsed = JSON.parse(jsonMatch[0]) as NoteAuditAiResult;

  return { result: parsed, notesCount: notes.length };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Generate (or return existing) audit report for one manager for a given week. */
export async function generateNoteAudit(
  managerId: string,
  weekOffset = -1,
): Promise<string> {
  const { start, end } = tashkentWeekRange(weekOffset);

  const existing = await prisma.noteAuditReport.findFirst({
    where: { managerId, periodStart: start, periodEnd: end, status: { in: ['DONE', 'PENDING'] } },
  });
  if (existing) return existing.id;

  const user = await prisma.user.findUnique({
    where: { id: managerId },
    select: { fullName: true },
  });
  if (!user) throw new AppError(404, 'Менеджер не найден');

  // Create placeholder
  const report = await prisma.noteAuditReport.create({
    data: {
      managerId,
      periodStart: start,
      periodEnd: end,
      scoreSpecificity: 0,
      scoreFollowUp: 0,
      scoreNextStep: 0,
      scoreTone: 0,
      scoreOverall: 0,
      summary: '',
      feedbackSpecificity: '',
      feedbackFollowUp: '',
      feedbackNextStep: '',
      feedbackTone: '',
      notesCount: 0,
      status: 'PENDING',
    },
  });

  // Run analysis async (but still await — caller decides whether to detach)
  try {
    const { result, notesCount } = await runAiAnalysis({
      managerId,
      managerName: user.fullName,
      start,
      end,
    });

    await prisma.noteAuditReport.update({
      where: { id: report.id },
      data: {
        status: 'DONE',
        scoreSpecificity: result.scoreSpecificity,
        scoreFollowUp: result.scoreFollowUp,
        scoreNextStep: result.scoreNextStep,
        scoreTone: result.scoreTone,
        scoreOverall: result.scoreOverall,
        summary: result.summary,
        feedbackSpecificity: result.feedbackSpecificity,
        feedbackFollowUp: result.feedbackFollowUp,
        feedbackNextStep: result.feedbackNextStep,
        feedbackTone: result.feedbackTone,
        goodExamples: JSON.stringify(result.goodExamples ?? []),
        badExamples: JSON.stringify(result.badExamples ?? []),
        notesCount,
      },
    });
  } catch (err) {
    await prisma.noteAuditReport.update({
      where: { id: report.id },
      data: {
        status: 'ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  return report.id;
}

/** Generate reports for all active managers — runs sequentially to respect API limits. */
export async function generateNoteAuditForAll(weekOffset = -1): Promise<void> {
  const managers = await prisma.user.findMany({
    where: { isActive: true, role: 'MANAGER' },
    select: { id: true },
  });

  for (const m of managers) {
    try {
      await generateNoteAudit(m.id, weekOffset);
    } catch (e) {
      console.error(`[NoteAudit] Failed for manager ${m.id}:`, e);
    }
  }
}
