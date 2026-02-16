import { z } from 'zod';

export const createContractDto = z.object({
  clientId: z.string().uuid('Некорректный ID клиента'),
  contractNumber: z.string().min(1, 'Номер договора обязателен'),
  startDate: z.string().min(1, 'Дата начала обязательна'),
  endDate: z.string().optional(),
  notes: z.string().optional(),
});

export const updateContractDto = z.object({
  contractNumber: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export type CreateContractDto = z.infer<typeof createContractDto>;
export type UpdateContractDto = z.infer<typeof updateContractDto>;
