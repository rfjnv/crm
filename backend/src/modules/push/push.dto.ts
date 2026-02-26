import { z } from 'zod';

export const subscribeDto = z.object({
  endpoint: z.string().url('Неверный endpoint'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh обязателен'),
    auth: z.string().min(1, 'auth обязателен'),
  }),
});

export const unsubscribeDto = z.object({
  endpoint: z.string().url('Неверный endpoint'),
});

export type SubscribeDto = z.infer<typeof subscribeDto>;
export type UnsubscribeDto = z.infer<typeof unsubscribeDto>;
