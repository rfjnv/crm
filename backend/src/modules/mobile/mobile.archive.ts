import fs from 'fs/promises';
import prisma from '../../lib/prisma';
import { formatUzPhone } from '../../lib/phone';
import { TASHKENT_OFFSET_MS } from '../../lib/tz';
import { MOBILE_CALL_TYPE_LABELS, type MobileCallType } from './mobile.mapping';
import { getMobileSettings } from './mobile.settings';
import { audioExt, audioMime, downloadToTemp, removeFiles } from './mobile.storage';
import {
  deleteFromDrive,
  ensureFolderPath,
  isDriveConnected,
  recordDriveError,
  resetFolders,
  uploadToDrive,
} from './mobile.drive';

/**
 * Записи хранятся на Google Drive (бесплатно), а Supabase — только буфер на несколько дней:
 * пока запись свежая, её можно послушать быстро и разобрать аудитом. Скопированная на Drive
 * запись удаляется из Supabase через recordingsBufferDays.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DRIVE_ATTEMPTS = 5;
const ARCHIVE_BATCH = 15;

/** Drive не разрешает «/» и плохо дружит с « : * ? " < > | » в именах. */
export function safeDriveName(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'без названия';
}

function tashkentParts(at: Date) {
  const iso = new Date(at.getTime() + TASHKENT_OFFSET_MS).toISOString();
  return { month: iso.slice(0, 7), stamp: `${iso.slice(0, 10)} ${iso.slice(11, 13)}-${iso.slice(14, 16)}` };
}

export interface ArchiveNameInput {
  managerName: string;
  ext: string;
  fileName: string;
  createdAt: Date;
  call: { startedAt: Date; mobileType: string | null; phone: string | null; clientName: string | null } | null;
}

/**
 * Где лежит запись на Drive: «CallSync — записи звонков / Дилноза Каримова / 2026-10 /
 * 2026-10-03 14-25 Входящий +998 90 123 45 67 Print House.m4a». Без звонка — в «Без звонка».
 */
export function archiveLocation(input: ArchiveNameInput): { folders: string[]; name: string } {
  const manager = safeDriveName(input.managerName);
  if (!input.call) {
    const { month } = tashkentParts(input.createdAt);
    return { folders: [manager, month, 'Без звонка'], name: safeDriveName(input.fileName) };
  }
  const { month, stamp } = tashkentParts(input.call.startedAt);
  const type = input.call.mobileType ? MOBILE_CALL_TYPE_LABELS[input.call.mobileType as MobileCallType] ?? input.call.mobileType : 'Звонок';
  const parts = [stamp, type, formatUzPhone(input.call.phone) ?? input.call.phone ?? 'скрытый номер', input.call.clientName].filter(Boolean);
  return { folders: [manager, month], name: `${safeDriveName(parts.join(' '))}.${input.ext}` };
}

let archiving = false;

/** Копирует на Drive записи, которых там ещё нет. Возвращает, сколько скопировано. */
export async function archiveRecordings(): Promise<number> {
  if (archiving || !(await isDriveConnected())) return 0;
  archiving = true;
  let done = 0;
  try {
    const batch = await prisma.callRecording.findMany({
      where: { storagePath: { not: null }, driveFileId: null, driveAttempts: { lt: MAX_DRIVE_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: ARCHIVE_BATCH,
      select: {
        id: true,
        storagePath: true,
        fileName: true,
        createdAt: true,
        callSessionId: true,
        user: { select: { fullName: true } },
        callSession: { select: { startedAt: true, mobileType: true, phone: true, client: { select: { companyName: true } } } },
      },
    });
    for (const rec of batch) {
      const ext = audioExt(rec.storagePath);
      let local: string | null = null;
      try {
        const where = archiveLocation({
          managerName: rec.user.fullName,
          ext,
          fileName: rec.fileName,
          createdAt: rec.createdAt,
          call: rec.callSession
            ? { startedAt: rec.callSession.startedAt, mobileType: rec.callSession.mobileType, phone: rec.callSession.phone, clientName: rec.callSession.client?.companyName ?? null }
            : null,
        });
        local = await downloadToTemp(rec.storagePath!);
        let folderId = await ensureFolderPath(where.folders);
        let fileId: string;
        try {
          fileId = await uploadToDrive(local, where.name, audioMime(ext), folderId);
        } catch (err) {
          // Папку удалили руками на Drive — создаём заново и пробуем ещё раз
          if ((err as { status?: number }).status !== 404) throw err;
          await resetFolders();
          folderId = await ensureFolderPath(where.folders);
          fileId = await uploadToDrive(local, where.name, audioMime(ext), folderId);
        }
        await prisma.callRecording.update({
          where: { id: rec.id },
          data: { driveFileId: fileId, archivedAt: new Date(), driveError: null },
        });
        if (rec.callSessionId) {
          await prisma.callSession.update({ where: { id: rec.callSessionId }, data: { driveFileId: fileId } });
        }
        done += 1;
      } catch (err) {
        const message = (err as Error).message || 'ошибка';
        console.error(`[mobile] drive archive ${rec.id} failed:`, message);
        await prisma.callRecording.update({
          where: { id: rec.id },
          data: { driveAttempts: { increment: 1 }, driveError: message.slice(0, 500) },
        });
        await recordDriveError(`Не удалось скопировать запись: ${message}`);
        // Доступ к Drive пропал — остальные записи в этот раз не трогаем
        if (!(await isDriveConnected())) break;
      } finally {
        if (local) await fs.unlink(local).catch(() => {});
      }
    }
  } finally {
    archiving = false;
  }
  return done;
}

/** Пока запись в очереди разбора, её файл в Supabase нужен — не удаляем. */
const AUDIO_IN_PROGRESS = ['UPLOADED', 'TRANSCRIBING'] as const;

/**
 * Чистка Supabase: скопированные на Drive записи старше recordingsBufferDays; любые записи
 * старше 12 месяцев (если Drive так и не подключили). Плюс срок хранения на самом Drive.
 */
export async function cleanupRecordings(now: Date = new Date()): Promise<{ buffer: number; expired: number; drive: number }> {
  const settings = await getMobileSettings();
  const result = { buffer: 0, expired: 0, drive: 0 };

  const removeFromSupabase = async (rows: { id: string; storagePath: string | null }[]) => {
    const paths = rows.map((r) => r.storagePath!).filter(Boolean);
    if (paths.length === 0) return;
    await removeFiles(paths);
    await prisma.callRecording.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { storagePath: null } });
    await prisma.callSession.updateMany({ where: { recordingPath: { in: paths } }, data: { recordingPath: null } });
  };

  const bufferCutoff = new Date(now.getTime() - Math.max(1, settings.recordingsBufferDays) * DAY_MS);
  for (;;) {
    const rows = await prisma.callRecording.findMany({
      where: {
        storagePath: { not: null },
        driveFileId: { not: null },
        createdAt: { lt: bufferCutoff },
        OR: [
          { callSessionId: null },
          { callSession: { audioStatus: { notIn: [...AUDIO_IN_PROGRESS] } } },
        ],
      },
      select: { id: true, storagePath: true },
      take: 100,
    });
    await removeFromSupabase(rows);
    result.buffer += rows.length;
    if (rows.length < 100) break;
  }

  const yearAgo = new Date(now);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 12);
  for (;;) {
    const rows = await prisma.callRecording.findMany({
      where: { storagePath: { not: null }, createdAt: { lt: yearAgo } },
      select: { id: true, storagePath: true },
      take: 100,
    });
    await removeFromSupabase(rows);
    result.expired += rows.length;
    if (rows.length < 100) break;
  }

  if (settings.driveRetentionMonths > 0 && (await isDriveConnected())) {
    const driveCutoff = new Date(now);
    driveCutoff.setUTCMonth(driveCutoff.getUTCMonth() - settings.driveRetentionMonths);
    const rows = await prisma.callRecording.findMany({
      where: { driveFileId: { not: null }, createdAt: { lt: driveCutoff } },
      select: { id: true, driveFileId: true },
      take: 200,
    });
    for (const r of rows) {
      await deleteFromDrive(r.driveFileId!);
      await prisma.callRecording.update({ where: { id: r.id }, data: { driveFileId: null } });
      await prisma.callSession.updateMany({ where: { driveFileId: r.driveFileId }, data: { driveFileId: null } });
      result.drive += 1;
    }
  }
  return result;
}
