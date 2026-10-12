import { config } from '../../lib/config';
import { BACKFILL_DAYS, syncRecentDays } from './timepay.service';

/**
 * Раз в 10 минут подтягиваем посещаемость за вчера и сегодня из TimePay (вчера — ради ухода ночной
 * смены после полуночи). Тихо пропускаем, если токен не настроен.
 */
async function tick(days: number): Promise<void> {
  try {
    const result = await syncRecentDays(days);
    if (result.status === 'SUCCESS') {
      console.log(`[timepay] sync ok (${days}d): matched=${result.matched} unmatched=${result.unmatched}`);
    } else if (result.status === 'ERROR' || result.status === 'AUTH_ERROR') {
      console.error(`[timepay] sync failed (${result.status}): ${result.error}`);
    }
  } catch (err) {
    console.error('[timepay] scheduler tick failed:', err instanceof Error ? err.message : err);
  }
}

setInterval(() => {
  tick(2).catch(() => {});
}, config.timepay.syncIntervalMs);

// Первичный синк вскоре после старта сервера (не сразу, чтобы не мешать остальной инициализации) —
// сразу за последние дни, чтобы догнать пропущенное, пока сервер не работал.
setTimeout(() => {
  tick(BACKFILL_DAYS).catch(() => {});
}, 15000);
