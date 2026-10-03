import fs from 'fs/promises';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { analyzeSalesCallTranscript, transcribeAudioFile } from '../ai-assistant/ai-assistant.service';
import { getMobileSettings } from './mobile.settings';
import { audioExt, audioMime, downloadToTemp, removeFiles } from './mobile.storage';

/**
 * Очередь транскрибации и аудита записей — в БД (audioStatus = UPLOADED), без очередей
 * в памяти: Render может перезапустить процесс в любой момент. Записи разбираются по одной.
 */

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 15 * 60 * 1000;
/** TRANSCRIBING дольше этого — процесс умер посреди обработки */
const STUCK_AFTER_MS = 30 * 60 * 1000;

let running = false;

async function releaseStuck(now: Date): Promise<void> {
  await prisma.callSession.updateMany({
    where: { audioStatus: 'TRANSCRIBING', updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    data: { audioStatus: 'FAILED', audioError: 'Обработка прервалась (перезапуск сервера)' },
  });
}

/**
 * Атомарно забирает одну запись (SKIP LOCKED — безопасно и при нескольких процессах).
 * Date в сыром SQL приходит как timestamptz, а колонки — timestamp в UTC: приводим явно,
 * иначе при не-UTC часовом поясе сессии сравнение съезжает на смещение пояса.
 */
async function claimNext(now: Date): Promise<string | null> {
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE call_sessions
    SET audio_status = 'TRANSCRIBING', audio_attempts = audio_attempts + 1,
        updated_at = (${now}::timestamptz AT TIME ZONE 'UTC')
    WHERE id = (
      SELECT id FROM call_sessions
      WHERE recording_path IS NOT NULL
        AND audio_attempts < ${MAX_ATTEMPTS}
        AND (audio_status = 'UPLOADED'
          OR (audio_status = 'FAILED' AND updated_at < (${retryBefore}::timestamptz AT TIME ZONE 'UTC')))
      ORDER BY started_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

async function processOne(id: string): Promise<void> {
  const call = await prisma.callSession.findUnique({
    where: { id },
    select: { id: true, recordingPath: true, durationSec: true, transcript: true, managerUserId: true, clientId: true },
  });
  if (!call?.recordingPath) return;

  const settings = await getMobileSettings();
  if (!settings.autoAuditEnabled || (call.durationSec ?? 0) < settings.minAuditDurationSec || !call.managerUserId) {
    await prisma.callSession.update({
      where: { id },
      data: { audioStatus: 'SKIPPED', audioError: !call.managerUserId ? 'Не указан менеджер' : 'Автоаудит выключен или звонок слишком короткий' },
    });
    return;
  }

  try {
    let transcript = call.transcript;
    // Повтор после сбоя аудита не платит за расшифровку второй раз
    if (!transcript) {
      const local = await downloadToTemp(call.recordingPath);
      try {
        const stat = await fs.stat(local);
        const ext = audioExt(call.recordingPath);
        const stt = await transcribeAudioFile(
          { path: local, originalname: `recording.${ext}`, mimetype: audioMime(ext), size: stat.size } as Express.Multer.File,
          { languageMode: 'auto' },
        );
        transcript = stt.text;
      } finally {
        await fs.unlink(local).catch(() => {});
      }
      await prisma.callSession.update({ where: { id }, data: { transcript, audioStatus: 'TRANSCRIBED', audioError: null } });
    }

    const audit = await analyzeSalesCallTranscript(transcript, 'mixed', {
      userId: call.managerUserId,
      managerId: call.managerUserId,
      clientId: call.clientId ?? undefined,
      audioDuration: call.durationSec ?? undefined,
      source: 'mobile',
    });
    await prisma.callSession.update({
      where: { id },
      data: { auditId: audit.auditId ?? null, audioStatus: 'ANALYZED', audioError: null },
    });
  } catch (err) {
    const message = (err as Error).message || 'Неизвестная ошибка';
    // В записи нет речи — повтор не поможет
    if (err instanceof AppError && err.statusCode === 400) {
      await prisma.callSession.update({ where: { id }, data: { audioStatus: 'SKIPPED', audioError: message.slice(0, 500) } });
      return;
    }
    console.error(`[mobile] audio ${id} failed:`, message);
    await prisma.callSession.update({ where: { id }, data: { audioStatus: 'FAILED', audioError: message.slice(0, 500) } });
  }
}

/** Разбирает очередь, пока в ней есть записи. Повторный вызов во время работы — no-op. */
export async function drainAudioQueue(maxItems = 20): Promise<number> {
  if (running) return 0;
  running = true;
  let done = 0;
  try {
    await releaseStuck(new Date());
    while (done < maxItems) {
      const id = await claimNext(new Date());
      if (!id) break;
      await processOne(id);
      done += 1;
    }
  } finally {
    running = false;
  }
  return done;
}

// ─── Срок хранения ──────────────────────────────────────────────────────────

const RETENTION_MONTHS = 12;
const BATCH = 100;

/** Файлы записей старше 12 месяцев удаляются из bucket. Журнал звонков хранится бессрочно. */
export async function cleanupOldRecordings(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  let removed = 0;
  for (;;) {
    const batch = await prisma.callRecording.findMany({
      where: { createdAt: { lt: cutoff }, storagePath: { not: null } },
      select: { id: true, storagePath: true },
      take: BATCH,
    });
    if (batch.length === 0) break;
    const paths = batch.map((b) => b.storagePath!);
    await removeFiles(paths);
    await prisma.callRecording.updateMany({ where: { id: { in: batch.map((b) => b.id) } }, data: { storagePath: null } });
    await prisma.callSession.updateMany({ where: { recordingPath: { in: paths } }, data: { recordingPath: null } });
    removed += batch.length;
    if (batch.length < BATCH) break;
  }
  return removed;
}
