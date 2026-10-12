import { z } from 'zod';

const score = z.number().int().min(1).max(5).nullable().optional();
const text = z.string().max(2000).nullable().optional();

export const upsertEmployeeReviewDto = z.object({
  year: z.number().int(),
  month: z.number().int(),
  discipline: score,
  quality: score,
  initiative: score,
  teamwork: score,
  praise: text,
  remarks: text,
  improve: text,
});

export type UpsertEmployeeReviewDto = z.infer<typeof upsertEmployeeReviewDto>;
