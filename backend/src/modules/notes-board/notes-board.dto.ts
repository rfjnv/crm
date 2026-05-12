import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });

export const notesBoardCallResultValues = ['ANSWERED', 'NO_ANSWER'] as const;
export const notesBoardReminderStateValues = ['OVERDUE', 'TODAY', 'UPCOMING', 'NONE'] as const;
export const notesBoardSortByValues = [
  'LAST_CALL_AT',
  'NEXT_CALL_AT',
  'CREATED_AT',
  'UPDATED_AT',
  'CLIENT_NAME',
] as const;

export const listNotesBoardQueryDto = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(500).optional(),
    clientId: z.string().uuid().optional(),
    authorId: z.string().uuid().optional(),
    callResult: z.enum(notesBoardCallResultValues).optional(),
    status: z.string().trim().min(1).max(120).optional(),
    q: z.string().trim().max(200).optional(),
    reminderState: z.enum(notesBoardReminderStateValues).optional(),
    lastCallFrom: isoDate.optional(),
    lastCallTo: isoDate.optional(),
    sortBy: z.enum(notesBoardSortByValues).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .superRefine((data, ctx) => {
    const ps = data.pageSize;
    if (ps != null && ps > 200 && !data.clientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pageSize больше 200 доступен только вместе с clientId',
        path: ['pageSize'],
      });
    }
    if (data.lastCallFrom && data.lastCallTo && new Date(data.lastCallFrom) > new Date(data.lastCallTo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Дата начала не может быть позже даты конца',
        path: ['lastCallFrom'],
      });
    }
  });

export const listMyEditRequestsQueryDto = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const createNotesBoardDto = z.object({
  clientId: z.string().uuid('Некорректный ID клиента'),
  callResult: z.enum(notesBoardCallResultValues),
  status: z.string().trim().max(120).optional(),
  phoneNumber: z.string().trim().max(40).optional().nullable(),
  comment: z.string().trim().min(1, 'Комментарий обязателен').max(20000),
  lastCallAt: isoDate,
  nextCallAt: isoDate.optional().nullable(),
});

export const updateNotesBoardDto = z.object({
  callResult: z.enum(notesBoardCallResultValues).optional(),
  status: z.string().trim().max(120).optional().nullable(),
  phoneNumber: z.string().trim().max(40).optional().nullable(),
  comment: z.string().trim().min(1, 'Комментарий обязателен').max(20000).optional(),
  lastCallAt: isoDate.optional(),
  nextCallAt: isoDate.optional().nullable(),
});

export const requestNotesBoardEditDto = z.object({
  comment: z.string().trim().min(1, 'Комментарий обязателен').max(1000),
});

export type ListNotesBoardQueryDto = z.infer<typeof listNotesBoardQueryDto>;
export type ListMyEditRequestsQueryDto = z.infer<typeof listMyEditRequestsQueryDto>;
export type CreateNotesBoardDto = z.infer<typeof createNotesBoardDto>;
export type UpdateNotesBoardDto = z.infer<typeof updateNotesBoardDto>;
export type RequestNotesBoardEditDto = z.infer<typeof requestNotesBoardEditDto>;
