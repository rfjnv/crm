import { sendDailyClosedDealsToWarehouse } from './reports.routes';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const TARGET_HOUR = 20;
const TARGET_MINUTE = 0;
let lastRunYmd = '';

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
  if (lastRunYmd === now.ymd) return;

  try {
    const result = await sendDailyClosedDealsToWarehouse();
    if (result.ok) {
      lastRunYmd = now.ymd;
    }
  } catch (error) {
    console.error('[daily-closed-deals] scheduler failed:', (error as Error).message);
  }
}

setInterval(() => {
  tick().catch(() => {});
}, 30000);
