import { z } from 'zod';

export const EXPENSE_METHODS = [
  'CASH',
  'TRANSFER',
  'PAYME',
  'QR',
  'CLICK',
  'TERMINAL',
  'INSTALLMENT',
] as const;

export const createExpenseDto = z.object({
  date: z.string(),
  category: z.string().min(1),
  amount: z.number().positive(),
  note: z.string().optional(),
  method: z.enum(EXPENSE_METHODS).default('CASH'),
});

export const rejectExpenseDto = z.object({
  reason: z.string().min(1, 'Укажите причину отклонения'),
});
