import { z } from 'zod';

const permissionValues = [
  'manage_users',
  'view_all_deals',
  'manage_deals',
  'manage_leads',
  'close_deals',
  'archive_deals',
  'stock_confirm',
  'finance_approve',
  'admin_approve',
  'confirm_shipment',
  'manage_inventory',
  'manage_products',
  'view_all_clients',
] as const;

const roleValues = ['ADMIN', 'OPERATOR', 'MANAGER', 'ACCOUNTANT', 'WAREHOUSE', 'WAREHOUSE_MANAGER'] as const;

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
});

export type CreateUserDto = z.infer<typeof createUserDto>;
export type UpdateUserDto = z.infer<typeof updateUserDto>;
