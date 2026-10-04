import { tashkentDayKey } from '../../lib/tz';
import { drainAudioQueue } from './mobile.audio-queue';
import { archiveRecordings, cleanupRecordings } from './mobile.archive';
import { runMobileChecks } from './mobile.alerts';

/**
 * Периодическая работа мобильной телефонии: алерты руководителю, срок хранения записей,
 * очередь аудита. Запускается из mobile.scheduler и из POST /api/internal/mobile/tick.
 */

let lastRetentionDay = '';
let checksRunning = false;

export async function runMobileTick(now: Date = new Date()) {
  if (checksRunning) return { skipped: 'проверка уже идёт' };
  checksRunning = true;
  try {
    const checks = await runMobileChecks(now);
    let cleanup = null;
    const day = tashkentDayKey(now);
    if (day !== lastRetentionDay) {
      cleanup = await cleanupRecordings(now);
      lastRetentionDay = day;
    }
    return { checks, cleanup };
  } finally {
    checksRunning = false;
  }
}

/**
 * Аудит записей и копирование на Google Drive не ждём: на одну запись уходит до минуты,
 * cron столько ждать не будет.
 */
export function kickAudioQueue(): void {
  drainAudioQueue().catch((err) => console.error('[mobile] audio queue failed:', (err as Error).message));
  archiveRecordings().catch((err) => console.error('[mobile] drive archive failed:', (err as Error).message));
}

