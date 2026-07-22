/**
 * Импорт исторических данных посещаемости (приход/уход) из Excel-выгрузки внешней
 * системы учёта. Строки без совпавшего сотрудника или без даты пропускаются со счётчиком.
 *
 * Использование:
 *   npm run import-attendance -- "C:\path\to\attendance.xlsx"
 *
 * Ожидаемые колонки (регистр не важен, порядок любой):
 *   ФИО | Сотрудник | Employee   — полное имя сотрудника (сверяется с users.full_name)
 *   Дата | Date                  — дата (Excel-дата или строка ДД.ММ.ГГГГ / ГГГГ-ММ-ДД)
 *   Приход | Вход | Check-in     — время прихода (ЧЧ:ММ), необязательно
 *   Уход | Выход | Check-out     — время ухода (ЧЧ:ММ), необязательно
 */
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Компания работает в Ташкенте (UTC+5, без перехода на летнее время). */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

const NAME_KEYS = ['фио', 'сотрудник', 'employee', 'имя'];
const DATE_KEYS = ['дата', 'date'];
const CHECKIN_KEYS = ['приход', 'вход', 'check-in', 'checkin'];
const CHECKOUT_KEYS = ['уход', 'выход', 'check-out', 'checkout'];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

function findKey(row: Record<string, unknown>, candidates: string[]): string | undefined {
  return Object.keys(row).find((k) => candidates.includes(normalizeHeader(k)));
}

function excelSerialToDate(value: number): Date {
  // Excel epoch: 1899-12-30
  const ms = Math.round((value - 25569) * 86400 * 1000);
  return new Date(ms);
}

function parseDateCell(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const d = excelSerialToDate(value);
    return d.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  const ddmmyyyy = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(str);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function parseTimeCell(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    // доля суток (0..1) — время без даты
    const totalMinutes = Math.round(value * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const str = String(value).trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(str);
  if (!match) return null;
  const [, h, m] = match;
  return `${h.padStart(2, '0')}:${m}`;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Укажите путь к Excel-файлу: npm run import-attendance -- "путь\\к\\файлу.xlsx"');
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  console.log(`Прочитано строк: ${rows.length}`);

  const users = await prisma.user.findMany({ select: { id: true, fullName: true } });
  const userByName = new Map(users.map((u) => [u.fullName.trim().toLowerCase(), u.id]));

  let created = 0;
  let updated = 0;
  let skippedNoUser = 0;
  let skippedNoDate = 0;
  const unmatchedNames = new Set<string>();

  for (const row of rows) {
    const nameKey = findKey(row, NAME_KEYS);
    const dateKey = findKey(row, DATE_KEYS);
    const checkInKey = findKey(row, CHECKIN_KEYS);
    const checkOutKey = findKey(row, CHECKOUT_KEYS);

    const rawName = nameKey ? String(row[nameKey] ?? '').trim() : '';
    if (!rawName) continue;

    const dateISO = dateKey ? parseDateCell(row[dateKey]) : null;
    if (!dateISO) {
      skippedNoDate += 1;
      continue;
    }

    const userId = userByName.get(rawName.toLowerCase());
    if (!userId) {
      skippedNoUser += 1;
      unmatchedNames.add(rawName);
      continue;
    }

    const checkInTime = checkInKey ? parseTimeCell(row[checkInKey]) : null;
    const checkOutTime = checkOutKey ? parseTimeCell(row[checkOutKey]) : null;

    const [y, mo, d] = dateISO.split('-').map(Number);
    // date-only, хранится в @db.Date без времени — смещать в UTC не нужно, иначе календарная дата съедет на день.
    const date = new Date(Date.UTC(y, mo - 1, d));
    const checkIn = checkInTime
      ? new Date(Date.UTC(y, mo - 1, d, ...checkInTime.split(':').map(Number) as [number, number]) - TASHKENT_OFFSET_MS)
      : null;
    const checkOut = checkOutTime
      ? new Date(Date.UTC(y, mo - 1, d, ...checkOutTime.split(':').map(Number) as [number, number]) - TASHKENT_OFFSET_MS)
      : null;

    const existing = await prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date } },
    });

    await prisma.attendanceRecord.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, checkIn, checkOut },
      update: { checkIn, checkOut },
    });

    if (existing) updated += 1;
    else created += 1;
  }

  console.log(`Создано: ${created}, обновлено: ${updated}`);
  console.log(`Пропущено (нет даты): ${skippedNoDate}`);
  console.log(`Пропущено (сотрудник не найден): ${skippedNoUser}`);
  if (unmatchedNames.size) {
    console.log('Несовпавшие имена:', [...unmatchedNames].join(', '));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
