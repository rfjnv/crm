import { z } from 'zod';

export const createClientDto = z.object({
  companyName: z.string().min(1, 'Название компании обязательно'),
  contactName: z.string().min(1, 'Контактное лицо обязательно'),
  phone: z.string().optional(),
  email: z.string().email('Некорректный email').optional().or(z.literal('')),
  address: z.string().optional(),
  notes: z.string().optional(),
  managerId: z.string().uuid('Некорректный ID менеджера').optional(),
  inn: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  mfo: z.string().optional(),
  vatRegCode: z.string().optional(),
  oked: z.string().optional(),
});

export const updateClientDto = z.object({
  companyName: z.string().min(1).optional(),
  contactName: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email('Некорректный email').optional().or(z.literal('')),
  address: z.string().optional(),
  notes: z.string().optional(),
  managerId: z.string().uuid('Некорректный ID менеджера').optional(),
  inn: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  mfo: z.string().optional(),
  vatRegCode: z.string().optional(),
  oked: z.string().optional(),
});

export type CreateClientDto = z.infer<typeof createClientDto>;
export type UpdateClientDto = z.infer<typeof updateClientDto>;
