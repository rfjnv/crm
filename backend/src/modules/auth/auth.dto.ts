import { z } from 'zod';

export const loginDto = z.object({
  login: z.string().min(1, 'Логин обязателен'),
  password: z.string().min(1, 'Пароль обязателен'),
});

export const refreshDto = z.object({
  refreshToken: z.string().optional(),
});

export const telegramWebAppDto = z.object({
  initData: z.string().min(1, 'initData обязателен'),
});

export type LoginDto = z.infer<typeof loginDto>;
export type RefreshDto = z.infer<typeof refreshDto>;
export type TelegramWebAppDto = z.infer<typeof telegramWebAppDto>;
