import Anthropic from '@anthropic-ai/sdk';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { formatUzPhone } from '../../lib/phone';
import { TASHKENT_OFFSET_MS } from '../../lib/tz';
import { MOBILE_CALL_TYPE_LABELS, type MobileCallType } from './mobile.mapping';
import { OPEN_TASK_STATUSES } from './mobile.processing';
import { removeFiles } from './mobile.storage';
import { deleteFromDrive, isDriveConnected } from './mobile.drive';

/**
 * Управление звонками для руководителя: разбор по выбору (аудит платный, поэтому не подряд),
 * общий анализ нескольких звонков, смена менеджера и удаление.
 */

interface ActingUser {
  userId: string;
}

export type AnalysisMode = 'AUDIT' | 'TRANSCRIPT';

/**
 * Поставить выбранные звонки в очередь разбора. AUDIT — расшифровка и аудит,
 * TRANSCRIPT — только расшифровка (для общего анализа, на запрос к Claude дешевле).
 * Ручной запрос обходит и выключенный постоянный анализ, и порог длительности.
 */
export async function requestAnalysis(user: ActingUser, callIds: string[], mode: AnalysisMode = 'AUDIT') {
  const calls = await prisma.callSession.findMany({
    where: { id: { in: callIds }, deletedAt: null },
    select: { id: true, recordingPath: true, driveFileId: true, audioStatus: true, auditId: true, transcript: true, analysisRequest: true },
  });
  const result = { queued: 0, alreadyDone: 0, noRecording: 0, inProgress: 0 };
  for (const c of calls) {
    if (!c.recordingPath && !c.driveFileId) { result.noRecording += 1; continue; }
    if (mode === 'AUDIT' ? !!c.auditId : !!c.transcript) { result.alreadyDone += 1; continue; }
    const request: AnalysisMode = c.analysisRequest === 'AUDIT' || mode === 'AUDIT' ? 'AUDIT' : 'TRANSCRIPT';
    if (c.audioStatus === 'TRANSCRIBING') {
      // Уже расшифровывается — только повышаем запрос до аудита, обработчик это увидит
      if (request !== c.analysisRequest) await prisma.callSession.update({ where: { id: c.id }, data: { analysisRequest: request } });
      result.inProgress += 1;
      continue;
    }
    await prisma.callSession.update({
      where: { id: c.id },
      data: { analysisRequest: request, analysisRequestedById: user.userId, audioStatus: 'UPLOADED', audioAttempts: 0, audioError: null },
    });
    result.queued += 1;
  }
  return result;
}

/** Звонок принял другой сотрудник (подменял коллегу) — переписать звонки, их аудиты и открытые задачи на него. */
export async function reassignCalls(callIds: string[], managerId: string) {
  const manager = await prisma.user.findFirst({ where: { id: managerId, isActive: true }, select: { id: true, fullName: true } });
  if (!manager) throw new AppError(404, 'Сотрудник не найден');
  const calls = await prisma.callSession.findMany({ where: { id: { in: callIds }, deletedAt: null }, select: { id: true, auditId: true } });
  const ids = calls.map((c) => c.id);
  await prisma.callSession.updateMany({ where: { id: { in: ids } }, data: { managerUserId: manager.id } });
  await prisma.task.updateMany({ where: { callSessionId: { in: ids }, status: { in: OPEN_TASK_STATUSES } }, data: { assigneeId: manager.id } });
  const auditIds = calls.map((c) => c.auditId).filter((v): v is string => !!v);
  if (auditIds.length > 0) {
    await prisma.callAudit.updateMany({ where: { id: { in: auditIds } }, data: { managerId: manager.id, managerName: manager.fullName } });
  }
  return { updated: ids.length, managerName: manager.fullName };
}

/**
 * Удалить звонки (личные, ошибочные). Записи стираются из Supabase и с Google Drive, аудиты —
 * из статистики. Сама строка звонка остаётся помеченной удалённой: иначе телефон при
 * повторной отправке создал бы звонок заново.
 */
export async function deleteCalls(user: ActingUser, callIds: string[]) {
  const calls = await prisma.callSession.findMany({ where: { id: { in: callIds }, deletedAt: null }, select: { id: true, auditId: true } });
  const ids = calls.map((c) => c.id);
  if (ids.length === 0) return { deleted: 0 };

  const recordings = await prisma.callRecording.findMany({
    where: { callSessionId: { in: ids } },
    select: { id: true, storagePath: true, driveFileId: true },
  });
  const paths = recordings.map((r) => r.storagePath).filter((v): v is string => !!v);
  if (paths.length > 0) {
    await removeFiles(paths).catch((err) => console.error('[mobile] delete call: supabase remove failed:', (err as Error).message));
  }
  if (await isDriveConnected()) {
    for (const r of recordings) {
      if (!r.driveFileId) continue;
      await deleteFromDrive(r.driveFileId).catch((err) => console.error('[mobile] delete call: drive delete failed:', (err as Error).message));
    }
  }
  await prisma.callRecording.updateMany({ where: { id: { in: recordings.map((r) => r.id) } }, data: { storagePath: null, driveFileId: null } });

  const auditIds = calls.map((c) => c.auditId).filter((v): v is string => !!v);
  if (auditIds.length > 0) await prisma.callAudit.deleteMany({ where: { id: { in: auditIds } } });
  await prisma.task.deleteMany({ where: { callSessionId: { in: ids }, status: { in: OPEN_TASK_STATUSES } } });
  await prisma.callSession.updateMany({
    where: { id: { in: ids } },
    data: {
      deletedAt: new Date(),
      deletedById: user.userId,
      recordingPath: null,
      driveFileId: null,
      transcript: null,
      auditId: null,
      audioStatus: 'SKIPPED',
      audioError: 'Звонок удалён',
      analysisRequest: null,
    },
  });
  return { deleted: ids.length };
}

// ─── Общий анализ по выбранным ──────────────────────────────────────────────

export const MAX_REPORT_CALLS = 50;
/** Длиннее — расшифровка сокращается, иначе 50 длинных разговоров не влезут в один запрос */
const TRANSCRIPT_LIMIT = 6000;
/** Дольше этого не ждём зависшие расшифровки — анализируем то, что есть */
const MAX_WAIT_MS = 2 * 60 * 60 * 1000;
const STUCK_RUNNING_MS = 30 * 60 * 1000;

function tashkentStamp(at: Date): string {
  const iso = new Date(at.getTime() + TASHKENT_OFFSET_MS).toISOString();
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

/** «1 звонок», «3 звонка», «12 звонков» */
export function callsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'звонок' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'звонка' : 'звонков';
  return `${n} ${word}`;
}

export async function createGroupReport(user: ActingUser, callIds: string[], title?: string) {
  const unique = [...new Set(callIds)];
  if (unique.length === 0) throw new AppError(400, 'Выберите звонки');
  if (unique.length > MAX_REPORT_CALLS) throw new AppError(400, `Не больше ${MAX_REPORT_CALLS} звонков в одном анализе`);
  const calls = await prisma.callSession.findMany({
    where: { id: { in: unique }, deletedAt: null },
    select: { id: true, startedAt: true, recordingPath: true, driveFileId: true, transcript: true },
    orderBy: { startedAt: 'asc' },
  });
  const usable = calls.filter((c) => c.transcript || c.recordingPath || c.driveFileId);
  if (usable.length === 0) throw new AppError(400, 'У выбранных звонков нет записей — анализировать нечего');

  // Нужны только расшифровки: отдельный аудит каждого звонка не заказываем
  await requestAnalysis(user, usable.filter((c) => !c.transcript).map((c) => c.id), 'TRANSCRIPT');
  const first = usable[0].startedAt;
  const last = usable[usable.length - 1].startedAt;
  const period = tashkentStamp(first).slice(0, 5) === tashkentStamp(last).slice(0, 5)
    ? tashkentStamp(first).slice(0, 5)
    : `${tashkentStamp(first).slice(0, 5)}–${tashkentStamp(last).slice(0, 5)}`;
  return prisma.callGroupReport.create({
    data: {
      title: title?.trim() || `Общий анализ: ${callsWord(usable.length)}, ${period}`,
      createdById: user.userId,
      callIds: usable.map((c) => c.id),
    },
    select: { id: true, title: true, status: true, createdAt: true },
  });
}

const REPORT_SYSTEM = `Ты — опытный руководитель отдела продаж B2B-компании в Ташкенте. Тебе дают расшифровки нескольких телефонных разговоров менеджеров с клиентами (русский и узбекский). Сделай общий разбор этой подборки звонков на русском языке.

Опирайся только на то, что есть в расшифровках, ничего не додумывай. Ссылайся на звонки по номерам («звонок 3»). Пиши коротко и по делу, в формате Markdown с заголовками второго уровня:

## Общая картина
## Что получается хорошо
## Повторяющиеся ошибки
## Возражения и вопросы клиентов
## Сравнение менеджеров  (только если в подборке больше одного менеджера)
## Лучшие и худшие звонки
## Что тренировать
(3–5 конкретных рекомендаций: что говорить и делать иначе)`;

type ReportCall = {
  id: string;
  startedAt: Date;
  durationSec: number | null;
  mobileType: string | null;
  phone: string | null;
  transcript: string | null;
  audioError: string | null;
  manager: { fullName: string } | null;
  client: { companyName: string } | null;
  auditId: string | null;
};

export function buildReportPrompt(calls: ReportCall[], scores: Map<string, number | null>): string {
  const blocks = calls.map((c, i) => {
    const type = c.mobileType ? MOBILE_CALL_TYPE_LABELS[c.mobileType as MobileCallType] ?? c.mobileType : 'Звонок';
    const minutes = `${Math.floor((c.durationSec ?? 0) / 60)}:${String((c.durationSec ?? 0) % 60).padStart(2, '0')}`;
    const head = [
      `### Звонок ${i + 1} — ${tashkentStamp(c.startedAt)}, ${type}, ${minutes}`,
      `Менеджер: ${c.manager?.fullName ?? 'не указан'}. Клиент: ${c.client?.companyName ?? formatUzPhone(c.phone) ?? 'неизвестный номер'}.`,
    ];
    const score = c.auditId ? scores.get(c.auditId) : null;
    if (score != null) head.push(`Оценка отдельного аудита: ${score}/10.`);
    if (!c.transcript) return [...head, `Расшифровки нет: ${c.audioError ?? 'не удалось расшифровать'}.`].join('\n');
    const text = c.transcript.length > TRANSCRIPT_LIMIT
      ? `${c.transcript.slice(0, TRANSCRIPT_LIMIT)}\n[…расшифровка сокращена: показаны первые ${TRANSCRIPT_LIMIT} знаков из ${c.transcript.length}]`
      : c.transcript;
    return [...head, 'Расшифровка:', text].join('\n');
  });
  return `Подборка из ${calls.length} звонков.\n\n${blocks.join('\n\n')}`;
}

async function runReport(reportId: string, callIds: string[]): Promise<void> {
  const calls = await prisma.callSession.findMany({
    where: { id: { in: callIds } },
    orderBy: { startedAt: 'asc' },
    select: {
      id: true, startedAt: true, durationSec: true, mobileType: true, phone: true, transcript: true, audioError: true, auditId: true,
      manager: { select: { fullName: true } },
      client: { select: { companyName: true } },
    },
  });
  if (!calls.some((c) => c.transcript)) {
    await prisma.callGroupReport.update({
      where: { id: reportId },
      data: { status: 'FAILED', error: 'Ни один звонок не удалось расшифровать', finishedAt: new Date() },
    });
    return;
  }
  if (!config.claude.apiKey) throw new Error('CLAUDE_API_KEY не настроен');
  const audits = await prisma.callAudit.findMany({
    where: { id: { in: calls.map((c) => c.auditId).filter((v): v is string => !!v) } },
    select: { id: true, score: true },
  });
  const client = new Anthropic({ apiKey: config.claude.apiKey });
  const message = await client.messages.create({
    model: config.claude.model,
    max_tokens: 8000,
    system: REPORT_SYSTEM,
    messages: [{ role: 'user', content: buildReportPrompt(calls, new Map(audits.map((a) => [a.id, a.score]))) }],
  });
  if (message.stop_reason === 'refusal') throw new Error('Модель отказалась анализировать эти звонки');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  if (!text) throw new Error('Пустой ответ модели');
  await prisma.callGroupReport.update({
    where: { id: reportId },
    data: { status: 'DONE', result: text, error: null, finishedAt: new Date() },
  });
}

let reportsRunning = false;

/** Отчёты, у которых все расшифровки готовы (или ждать уже нечего), уходят в Claude. */
export async function processCallReports(now: Date = new Date()): Promise<number> {
  if (reportsRunning) return 0;
  reportsRunning = true;
  let done = 0;
  try {
    // Процесс перезапустился посреди запроса — вернуть отчёт в очередь
    await prisma.callGroupReport.updateMany({
      where: { status: 'RUNNING', createdAt: { lt: new Date(now.getTime() - STUCK_RUNNING_MS) } },
      data: { status: 'WAITING' },
    });
    const reports = await prisma.callGroupReport.findMany({ where: { status: 'WAITING' }, orderBy: { createdAt: 'asc' }, take: 5 });
    for (const r of reports) {
      const pending = await prisma.callSession.count({
        where: {
          id: { in: r.callIds },
          deletedAt: null,
          transcript: null,
          OR: [
            { audioStatus: { in: ['UPLOADED', 'TRANSCRIBING'] } },
            { audioStatus: 'FAILED', audioAttempts: { lt: 3 } },
          ],
        },
      });
      if (pending > 0 && now.getTime() - r.createdAt.getTime() < MAX_WAIT_MS) continue;
      const claimed = await prisma.callGroupReport.updateMany({ where: { id: r.id, status: 'WAITING' }, data: { status: 'RUNNING' } });
      if (claimed.count === 0) continue;
      try {
        await runReport(r.id, r.callIds);
        done += 1;
      } catch (err) {
        const msg = err instanceof Anthropic.APIError ? `Claude: ${err.message}` : (err as Error).message;
        console.error(`[mobile] call report ${r.id} failed:`, msg);
        await prisma.callGroupReport.update({ where: { id: r.id }, data: { status: 'FAILED', error: msg.slice(0, 500), finishedAt: new Date() } });
      }
    }
  } finally {
    reportsRunning = false;
  }
  return done;
}
