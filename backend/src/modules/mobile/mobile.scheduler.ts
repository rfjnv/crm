import { kickAudioQueue, runMobileTick } from './mobile.tick';

/**
 * Фоновые задачи мобильной телефонии: очередь аудита записей раз в минуту, проверки
 * телефонов раз в 5 минут. На Render free процесс засыпает без запросов, и setInterval
 * тогда не срабатывает — поэтому то же самое запускает POST /api/internal/mobile/tick из внешнего cron.
 */

const AUDIO_EVERY_MS = 60_000;
const CHECKS_EVERY_MS = 5 * 60_000;

setInterval(kickAudioQueue, AUDIO_EVERY_MS);
setInterval(() => {
  runMobileTick().catch((err) => console.error('[mobile] checks failed:', (err as Error).message));
}, CHECKS_EVERY_MS);
