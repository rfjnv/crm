import { z } from 'zod';

const timeField = z.string().min(1).nullable().optional();

export const upsertAttendanceDto = z.object({
  userId: z.string().uuid(),
  date: z.string().min(1),
  checkIn: timeField,
  checkOut: timeField,
  note: z.string().max(500).nullable().optional(),
});

export type UpsertAttendanceDto = z.infer<typeof upsertAttendanceDto>;
