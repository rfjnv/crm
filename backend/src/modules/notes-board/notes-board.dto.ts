import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

export const notesBoardCallResultValues = ['ANSWERED', 'NO_ANSWER'] as const;

export const listNotesBoardQueryDto = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  clientId: z.string().uuid().optional(),
  authorId: z.string().uuid().optional(),
  callResult: z.enum(notesBoardCallResultValues).optional(),
  status: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().max(200).optional(),
});

export const createNotesBoardDto = z.object({
  clientId: z.string().uuid('Некорректный ID клиента'),
  callResult: z.enum(notesBoardCallResultValues),
  status: z.string().trim().max(120).optional(),
  comment: z.string().trim().min(1, 'Комментарий обязателен').max(20000),
  lastCallAt: isoDate,
  nextCallAt: isoDate.optional().nullable(),
});

export const updateNotesBoardDto = z.object({
  callResult: z.enum(notesBoardCallResultValues).optional(),
  status: z.string().trim().max(120).optional().nullable(),
  comment: z.string().trim().min(1, 'Комментарий обязателен').max(20000).optional(),
  lastCallAt: isoDate.optional(),
  nextCallAt: isoDate.optional().nullable(),
});

export type ListNotesBoardQueryDto = z.infer<typeof listNotesBoardQueryDto>;
export type CreateNotesBoardDto = z.infer<typeof createNotesBoardDto>;
export type UpdateNotesBoardDto = z.infer<typeof updateNotesBoardDto>;
