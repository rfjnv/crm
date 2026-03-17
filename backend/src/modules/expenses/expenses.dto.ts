import { z } from 'zod';

export const createExpenseDto = z.object({
  date: z.string(),
  category: z.string().min(1),
  amount: z.number().positive(),
  note: z.string().optional(),
});

export const rejectExpenseDto = z.object({
  reason: z.string().min(1, 'Укажите причину отклонения'),
});
