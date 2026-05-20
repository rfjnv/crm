import { z } from 'zod';

export const supabaseExchangeDto = z.object({
  accessToken: z.string().min(1, 'Требуется Supabase access token'),
});

export const createSupabaseUserDto = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(8, 'Пароль не менее 8 символов'),
  role: z.enum(['admin', 'superadmin']),
});

export const updateSupabaseUserRoleDto = z.object({
  role: z.enum(['admin', 'superadmin']),
});
