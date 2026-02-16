import { z } from 'zod';

const targetsSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ALL'),
  }),
  z.object({
    type: z.literal('USERS'),
    userIds: z.array(z.string().uuid()).min(1, 'Выберите хотя бы одного пользователя'),
  }),
  z.object({
    type: z.literal('ROLES'),
    roles: z.array(z.string()).min(1, 'Выберите хотя бы одну роль'),
  }),
  z.object({
    type: z.literal('DEALS_COUNT'),
    periodDays: z.number().int().min(1).max(365),
    operator: z.enum(['LT', 'GT', 'LTE', 'GTE']),
    value: z.number().int().min(0),
    roleFilter: z.string().optional(),
  }),
]);

export const broadcastDto = z.object({
  title: z.string().min(1, 'Заголовок обязателен').max(120, 'Максимум 120 символов'),
  body: z.string().min(1, 'Текст обязателен').max(2000, 'Максимум 2000 символов'),
  severity: z.enum(['INFO', 'WARNING', 'URGENT']).default('INFO'),
  link: z.string().max(500).optional(),
  targets: targetsSchema,
});

export const previewDto = z.object({
  targets: targetsSchema,
});

export type BroadcastDto = z.infer<typeof broadcastDto>;
export type PreviewDto = z.infer<typeof previewDto>;
