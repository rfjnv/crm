import { z } from 'zod';

export const setTimePayTokenDto = z.object({
  accessToken: z.string().min(10, 'Токен слишком короткий'),
});

export type SetTimePayTokenDto = z.infer<typeof setTimePayTokenDto>;
