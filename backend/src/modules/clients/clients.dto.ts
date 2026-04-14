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
  portraitProfile: z.string().max(20000).optional(),
  portraitGoals: z.string().max(20000).optional(),
  portraitPains: z.string().max(20000).optional(),
  portraitFears: z.string().max(20000).optional(),
  portraitObjections: z.string().max(20000).optional(),
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
  portraitProfile: z.string().max(20000).optional(),
  portraitGoals: z.string().max(20000).optional(),
  portraitPains: z.string().max(20000).optional(),
  portraitFears: z.string().max(20000).optional(),
  portraitObjections: z.string().max(20000).optional(),
});

export const setClientCreditStatusDto = z.object({
  creditStatus: z.enum(['NORMAL', 'SATISFACTORY', 'NEGATIVE']),
});

export type CreateClientDto = z.infer<typeof createClientDto>;
export type UpdateClientDto = z.infer<typeof updateClientDto>;
export type SetClientCreditStatusDto = z.infer<typeof setClientCreditStatusDto>;

export const createClientNoteDto = z.object({
  content: z.string().min(1, 'Текст заметки обязателен').max(20000, 'Слишком длинный текст'),
});

export const updateClientNoteDto = z.object({
  content: z.string().min(1, 'Текст заметки обязателен').max(20000, 'Слишком длинный текст'),
});

export type CreateClientNoteDto = z.infer<typeof createClientNoteDto>;
export type UpdateClientNoteDto = z.infer<typeof updateClientNoteDto>;
