import { z } from 'zod';

export const loginDto = z.object({
  login: z.string().min(1, 'Логин обязателен'),
  password: z.string().min(1, 'Пароль обязателен'),
});

export const refreshDto = z.object({
  refreshToken: z.string().min(1, 'Refresh token обязателен'),
});

export type LoginDto = z.infer<typeof loginDto>;
export type RefreshDto = z.infer<typeof refreshDto>;
