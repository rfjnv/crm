import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import type { UpsertAttendanceDto } from './attendance.dto';

const attendanceInclude = {
  user: { select: { id: true, fullName: true, department: true, role: true } },
  enteredBy: { select: { id: true, fullName: true } },
};

/** Компания работает в Ташкенте (UTC+5, без перехода на летнее время). */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** date-only, хранится в @db.Date без времени — смещать в UTC не нужно, иначе календарная дата съедет на день. */
function parseDateOnly(dateISO: string): Date {
  const m = YMD_RE.exec(dateISO.trim());
  if (!m) {
    throw new AppError(400, 'Некорректная дата');
  }
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
}

function combineDateAndTime(dateISO: string, time: string): Date {
  const dateMatch = YMD_RE.exec(dateISO.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dateMatch || !timeMatch) {
    throw new AppError(400, `Некорректное время: ${time}`);
  }
  const [, y, mo, d] = dateMatch;
  const [, h, min] = timeMatch;
  const result = new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min)) - TASHKENT_OFFSET_MS,
  );
  if (Number.isNaN(result.getTime())) {
    throw new AppError(400, `Некорректное время: ${time}`);
  }
  return result;
}

export async function listAttendance(filters: { userId?: string; from?: string; to?: string }) {
  const where: Record<string, unknown> = {};
  if (filters.userId) where.userId = filters.userId;
  if (filters.from || filters.to) {
    const dateFilter: Record<string, Date> = {};
    if (filters.from) dateFilter.gte = parseDateOnly(filters.from);
    if (filters.to) dateFilter.lte = parseDateOnly(filters.to);
    where.date = dateFilter;
  }

  return prisma.attendanceRecord.findMany({
    where,
    include: attendanceInclude,
    orderBy: [{ date: 'desc' }, { user: { fullName: 'asc' } }],
  });
}

export async function upsertAttendance(data: UpsertAttendanceDto, enteredById: string) {
  const date = parseDateOnly(data.date);
  const checkIn = data.checkIn ? combineDateAndTime(data.date, data.checkIn) : null;
  const checkOut = data.checkOut ? combineDateAndTime(data.date, data.checkOut) : null;

  if (checkIn && checkOut && checkOut <= checkIn) {
    throw new AppError(400, 'Время ухода должно быть позже времени прихода');
  }

  return prisma.attendanceRecord.upsert({
    where: { userId_date: { userId: data.userId, date } },
    create: {
      userId: data.userId,
      date,
      checkIn,
      checkOut,
      note: data.note ?? null,
      enteredById,
    },
    update: {
      checkIn,
      checkOut,
      note: data.note ?? null,
      enteredById,
    },
    include: attendanceInclude,
  });
}

export async function deleteAttendance(id: string) {
  await prisma.attendanceRecord.delete({ where: { id } });
}
