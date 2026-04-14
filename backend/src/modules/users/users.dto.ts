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
  role: z.enum(roleValues),
  permissions: z.array(z.enum(permissionValues)).optional(),
});

export const updateUserDto = z.object({
  login: z.string().min(1).max(50).optional(),
  fullName: z.string().min(1).optional(),
  role: z.enum(roleValues).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6, 'Минимум 6 символов').optional(),
  permissions: z.array(z.enum(permissionValues)).optional(),
  badgeIcon: badgeIconEnum.nullable().optional(),
  badgeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  badgeLabel: z.string().trim().max(48, 'Не более 48 символов').nullable().optional(),
});

export type CreateUserDto = z.infer<typeof createUserDto>;
export type UpdateUserDto = z.infer<typeof updateUserDto>;
