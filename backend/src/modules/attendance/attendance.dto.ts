import { z } from 'zod';
import { ATTENDANCE_MARKS } from '../../lib/attendanceMarks';

const timeField = z.string().min(1).nullable().optional();

export const upsertAttendanceDto = z.object({
  userId: z.string().uuid(),
  date: z.string().min(1),
  checkIn: timeField,
  checkOut: timeField,
  note: z.string().max(500).nullable().optional(),
});

/** Плашки и комментарий HR за день — время прихода и ухода не трогаем. */
export const markAttendanceDto = z.object({
  userId: z.string().uuid(),
  date: z.string().min(1),
  marks: z.array(z.enum(ATTENDANCE_MARKS)).max(ATTENDANCE_MARKS.length),
  note: z.string().max(500).nullable().optional(),
});

export type MarkAttendanceDto = z.infer<typeof markAttendanceDto>;
export type UpsertAttendanceDto = z.infer<typeof upsertAttendanceDto>;
