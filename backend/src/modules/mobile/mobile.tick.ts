import { tashkentDayKey } from '../../lib/tz';
import { cleanupOldRecordings, drainAudioQueue } from './mobile.audio-queue';
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
    let removedRecordings = 0;
    const day = tashkentDayKey(now);
    if (day !== lastRetentionDay) {
      removedRecordings = await cleanupOldRecordings(now);
      lastRetentionDay = day;
    }
    return { checks, removedRecordings };
  } finally {
    checksRunning = false;
  }
}

/** Разбор записей не ждём: аудит одной записи идёт минуту, cron столько ждать не будет. */
export function kickAudioQueue(): void {
  drainAudioQueue().catch((err) => console.error('[mobile] audio queue failed:', (err as Error).message));
}

