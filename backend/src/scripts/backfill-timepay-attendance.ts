/**
 * Догружает историческую посещаемость из TimePay за диапазон дат — синк по одному дню
 * за раз (API TimePay принимает только одну дату), с небольшой паузой между запросами.
 *
 * Запуск на проде:
 *   npm run backfill-timepay                          — с 1-го числа текущего месяца по сегодня
 *   npm run backfill-timepay -- 2026-07-01 2026-07-23  — произвольный диапазон
 */
import { PrismaClient } from '@prisma/client';
import { syncAttendanceFromTimePay, tashkentTodayYmd } from '../modules/timepay/timepay.service';

const prisma = new PrismaClient();

function firstDayOfCurrentMonthYmd(): string {
  const today = tashkentTodayYmd();
  const [y, m] = today.split('-');
  return `${y}-${m}-01`;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const [argFrom, argTo] = process.argv.slice(2);
  const from = argFrom || firstDayOfCurrentMonthYmd();
  const to = argTo || tashkentTodayYmd();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    console.error('Некорректный диапазон дат. Формат: YYYY-MM-DD YYYY-MM-DD, from <= to');
    process.exit(1);
  }

  console.log(`Догрузка посещаемости TimePay: ${from} → ${to}\n`);

  let totalMatched = 0;
  let totalUnmatched = 0;
  let ymd = from;

  while (ymd <= to) {
    const result = await syncAttendanceFromTimePay(ymd);
    if (result.status === 'SUCCESS') {
      console.log(`${ymd}: совпало ${result.matched} (по ID: ${result.matchedById}, по ФИО: ${result.matchedByName}), не найдено ${result.unmatched}`);
      totalMatched += result.matched;
      totalUnmatched += result.unmatched;
    } else if (result.status === 'AUTH_ERROR') {
      console.error(`${ymd}: токен TimePay недействителен — остановка`);
      break;
    } else {
      console.error(`${ymd}: ошибка — ${result.error}`);
    }

    ymd = addDays(ymd, 1);
    if (ymd <= to) await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nГотово. Всего совпало: ${totalMatched}, не найдено: ${totalUnmatched}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
