import { z } from 'zod';
import { ALL_PERMISSIONS } from '../../lib/permissions';
import { USER_BADGE_ICON_KEYS } from '../../lib/userBadges';

const badgeIconEnum = z.enum(USER_BADGE_ICON_KEYS as unknown as [string, ...string[]]);

const permissionValues = ALL_PERMISSIONS as unknown as readonly [string, ...string[]];

const roleValues = ['ADMIN', 'OPERATOR', 'MANAGER', 'ACCOUNTANT', 'WAREHOUSE', 'WAREHOUSE_MANAGER', 'DRIVER', 'LOADER'] as const;

export const createUserDto = z.object({
  login: z.string().min(1, 'Логин обязателен').max(50),
  password: z.string().min(6, 'Минимум 6 символов'),
  fullName: z.string().min(1, 'Имя обязательно'),
  department: z.string().trim().max(120).optional(),
  role: z.enum(roleValues),
  permissions: z.array(z.enum(permissionValues)).optional(),
});

export const updateUserDto = z.object({
  login: z.string().min(1).max(50).optional(),
  fullName: z.string().min(1).optional(),
  department: z.string().trim().max(120).nullable().optional(),
  role: z.enum(roleValues).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6, 'Минимум 6 символов').optional(),
  permissions: z.array(z.enum(permissionValues)).optional(),
  badgeIcon: badgeIconEnum.nullable().optional(),
  badgeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  badgeLabel: z.string().trim().max(48, 'Не более 48 символов').nullable().optional(),
});

export const upsertMonthlyGoalDto = z.object({
  year: z.number().int().min(2020).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  dealsTarget: z.number().int().min(0).nullable(),
  revenueTarget: z.number().min(0).nullable(),
  callNotesTarget: z.number().int().min(0).nullable(),
});

export const monthlyGoalQueryDto = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export type CreateUserDto = z.infer<typeof createUserDto>;
export type UpdateUserDto = z.infer<typeof updateUserDto>;
export type UpsertMonthlyGoalDto = z.infer<typeof upsertMonthlyGoalDto>;
export type MonthlyGoalQueryDto = z.infer<typeof monthlyGoalQueryDto>;
