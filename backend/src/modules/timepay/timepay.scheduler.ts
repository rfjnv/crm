import { config } from '../../lib/config';
import { syncAttendanceFromTimePay } from './timepay.service';

/** Раз в 10 минут подтягиваем посещаемость дня из TimePay. Тихо пропускаем, если токен не настроен. */
async function tick(): Promise<void> {
  try {
    const result = await syncAttendanceFromTimePay();
    if (result.status === 'SUCCESS') {
      console.log(`[timepay] sync ok: matched=${result.matched} unmatched=${result.unmatched}`);
    } else if (result.status === 'ERROR' || result.status === 'AUTH_ERROR') {
      console.error(`[timepay] sync failed (${result.status}): ${result.error}`);
    }
  } catch (err) {
    console.error('[timepay] scheduler tick failed:', err instanceof Error ? err.message : err);
  }
}

setInterval(() => {
  tick().catch(() => {});
}, config.timepay.syncIntervalMs);

// Первичный синк вскоре после старта сервера (не сразу, чтобы не мешать остальной инициализации).
setTimeout(() => {
  tick().catch(() => {});
}, 15000);
