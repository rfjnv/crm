import fs from 'fs/promises';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { analyzeSalesCallTranscript, transcribeAudioFile } from '../ai-assistant/ai-assistant.service';
import { getMobileSettings } from './mobile.settings';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { audioExt, audioMime, downloadToTemp } from './mobile.storage';
import { downloadDriveToFile } from './mobile.drive';

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
      WHERE (recording_path IS NOT NULL OR drive_file_id IS NOT NULL)
        AND deleted_at IS NULL
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
    select: {
      id: true, recordingPath: true, driveFileId: true, durationSec: true, transcript: true, managerUserId: true, clientId: true,
      analysisRequest: true,
    },
  });
  if (!call || (!call.recordingPath && !call.driveFileId)) return;

  // Ручной запрос (кнопка «Проанализировать» или общий анализ) идёт всегда;
  // без него — только при включённом постоянном анализе и не короче порога
  const request = call.analysisRequest as 'AUDIT' | 'TRANSCRIPT' | null;
  const settings = await getMobileSettings();
  if (!request && (!settings.autoAuditEnabled || (call.durationSec ?? 0) < settings.minAuditDurationSec)) {
    await prisma.callSession.update({
      where: { id },
      data: {
        audioStatus: 'SKIPPED',
        audioError: !settings.autoAuditEnabled
          ? 'Анализ не запускали'
          : `Звонок короче ${settings.minAuditDurationSec} с — не анализируем автоматически`,
      },
    });
    return;
  }

  try {
    let transcript = call.transcript;
    // Повтор после сбоя аудита не платит за расшифровку второй раз
    if (!transcript) {
      // Из Supabase, а если буфер уже почищен — с Google Drive
      const ext = audioExt(call.recordingPath ?? 'recording.m4a');
      let local: string;
      if (call.recordingPath) {
        local = await downloadToTemp(call.recordingPath);
      } else {
        local = path.join(os.tmpdir(), `callsync-${randomUUID()}.${ext}`);
        await downloadDriveToFile(call.driveFileId!, local);
      }
      try {
        const stat = await fs.stat(local);
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

    // Нужна была только расшифровка (общий анализ). Пока расшифровывали, могли попросить и аудит
    let wantAudit = request !== 'TRANSCRIPT';
    if (!wantAudit) {
      const fresh = await prisma.callSession.findUnique({ where: { id }, select: { analysisRequest: true } });
      wantAudit = fresh?.analysisRequest === 'AUDIT';
    }
    if (!wantAudit || !call.managerUserId) {
      await prisma.callSession.update({
        where: { id },
        data: {
          audioStatus: 'TRANSCRIBED',
          analysisRequest: null,
          audioError: wantAudit ? 'Не указан менеджер — аудит не сделан' : null,
        },
      });
      return;
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
      data: { auditId: audit.auditId ?? null, audioStatus: 'ANALYZED', audioError: null, analysisRequest: null },
    });
  } catch (err) {
    const message = (err as Error).message || 'Неизвестная ошибка';
    // В записи нет речи — повтор не поможет
    if (err instanceof AppError && err.statusCode === 400) {
      await prisma.callSession.update({ where: { id }, data: { audioStatus: 'SKIPPED', audioError: message.slice(0, 500), analysisRequest: null } });
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
