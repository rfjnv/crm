import { exchangeRatesService } from './exchange-rates.service';

/**
 * Ежедневный синк курсов ЦБ РУз.
 * Тот же паттерн, что у dailyClosedDeals.scheduler — setInterval + защита от повторного запуска в день.
 *
 * Время: 09:15 по Ташкенту (UTC+5). ЦБ обычно публикует курс раньше 09:00.
 * Также синкает при старте сервера, если на сегодня курсов ещё нет.
 */

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const TARGET_HOUR = 9;
const TARGET_MINUTE = 15;
let lastRunYmd = '';

function tashkentNow(): { ymd: string; hour: number; minute: number; date: Date } {
  const t = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return {
    ymd: `${y}-${m}-${d}`,
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    date: new Date(`${y}-${m}-${d}T00:00:00.000Z`),
  };
}

async function runSync(reason: string): Promise<void> {
  try {
    const result = await exchangeRatesService.syncFromCbu();
    console.log(
      `[exchange-rates] ${reason}: fetched=${result.fetched} upserted=${result.upserted} skipped=${result.skipped} sourceDate=${result.sourceDate ?? 'n/a'}`,
    );
    if (result.errors.length > 0) {
      console.warn(`[exchange-rates] errors:`, result.errors.slice(0, 3));
    }
  } catch (err) {
    console.error(
      `[exchange-rates] ${reason} failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function tick(): Promise<void> {
  const now = tashkentNow();
  if (now.hour !== TARGET_HOUR || now.minute !== TARGET_MINUTE) return;
  if (lastRunYmd === now.ymd) return;
  lastRunYmd = now.ymd;
  await runSync(`daily tick @ ${now.ymd} ${now.hour}:${String(now.minute).padStart(2, '0')} TSH`);
}

setInterval(() => {
  tick().catch(() => {});
}, 30000);

// Первичный запуск: если на сегодня курсов ещё нет — синкаем сразу.
setTimeout(() => {
  void (async () => {
    try {
      const today = tashkentNow().date;
      const has = await exchangeRatesService.hasRatesForDate(today);
      if (!has) {
        await runSync('initial sync on boot (no rates for today)');
      }
    } catch (err) {
      console.error(
        '[exchange-rates] initial check failed:',
        err instanceof Error ? err.message : err,
      );
    }
  })();
}, 10000);
