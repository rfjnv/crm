import { z } from 'zod';

export const createPoaDto = z.object({
  contractId: z.string().uuid(),
  poaNumber: z.string().min(1, 'Номер доверенности обязателен'),
  poaType: z.enum(['ANNUAL', 'ONE_TIME']),
  authorizedPersonName: z.string().min(1, 'ФИО доверенного лица обязательно'),
  authorizedPersonInn: z.string().optional(),
  authorizedPersonPosition: z.string().optional(),
  validFrom: z.string().min(1, 'Дата начала обязательна'),
  validUntil: z.string().min(1, 'Дата окончания обязательна'),
  items: z.array(z.object({
    name: z.string(),
    unit: z.string(),
    qty: z.number().optional(),
  })).optional(),
  notes: z.string().optional(),
});

export const updatePoaDto = z.object({
  poaNumber: z.string().min(1).optional(),
  poaType: z.enum(['ANNUAL', 'ONE_TIME']).optional(),
  authorizedPersonName: z.string().min(1).optional(),
  authorizedPersonInn: z.string().optional(),
  authorizedPersonPosition: z.string().optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  items: z.array(z.object({
    name: z.string(),
    unit: z.string(),
    qty: z.number().optional(),
  })).optional(),
  notes: z.string().optional(),
});

export type CreatePoaDto = z.infer<typeof createPoaDto>;
export type UpdatePoaDto = z.infer<typeof updatePoaDto>;
