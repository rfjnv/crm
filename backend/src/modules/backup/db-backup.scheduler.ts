import { runAndSendDailyBackup } from './db-backup.service';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const TARGET_HOUR = 3;
const TARGET_MINUTE = 0;

let lastRunYmd = '';
/** Дамп базы занимает десятки секунд — тик каждые 30с иначе запустил бы второй параллельно. */
let running = false;

function currentTashkentParts(): { ymd: string; hour: number; minute: number } {
  const t = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return { ymd: `${y}-${m}-${d}`, hour: t.getUTCHours(), minute: t.getUTCMinutes() };
}

async function tick(): Promise<void> {
  const now = currentTashkentParts();
  if (now.hour !== TARGET_HOUR || now.minute !== TARGET_MINUTE) return;
  if (lastRunYmd === now.ymd || running) return;

  // Помечаем день как обработанный ДО запуска: иначе долгий дамп словит следующий тик
  // и отправит второй бэкап тем же днём.
  lastRunYmd = now.ymd;
  running = true;
  try {
    const result = await runAndSendDailyBackup();
    if (!result.ok) {
      console.error('[db-backup] scheduler: бэкап не удался:', result.error);
    }
  } catch (error) {
    console.error('[db-backup] scheduler failed:', (error as Error).message);
  } finally {
    running = false;
  }
}

setInterval(() => {
  tick().catch(() => {});
}, 30000);
