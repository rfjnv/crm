import { z } from 'zod';

export const updateProfileDto = z
  .object({
    firstName: z.string().trim().min(1, 'Имя обязательно').max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    fullName: z.string().trim().min(2, 'ФИО минимум 2 символа').max(160).optional(),
    login: z.string().trim().min(1).max(50).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6, 'Пароль минимум 6 символов').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword && !data.currentPassword) {
      ctx.addIssue({ code: 'custom', message: 'Укажите текущий пароль', path: ['currentPassword'] });
    }
    const hasName = data.firstName !== undefined || data.lastName !== undefined || data.fullName !== undefined;
    const hasLogin = data.login !== undefined;
    const hasPwd = data.newPassword !== undefined;
    if (!hasName && !hasLogin && !hasPwd) {
      ctx.addIssue({ code: 'custom', message: 'Нет данных для обновления' });
    }
  });

export type UpdateProfileDto = z.infer<typeof updateProfileDto>;

export const dailyReportQueryDto = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
