import { z } from 'zod';

export const createWorkerReviewDto = z.object({
  managerId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Format: YYYY-MM'),
});

export const updateWorkerReviewDto = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
});

export type CreateWorkerReviewDto = z.infer<typeof createWorkerReviewDto>;
export type UpdateWorkerReviewDto = z.infer<typeof updateWorkerReviewDto>;
