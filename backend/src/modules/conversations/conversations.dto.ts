import { z } from 'zod';

export const sendMessageDto = z.object({
  text: z.string().min(1, 'Сообщение не может быть пустым').max(2000, 'Максимум 2000 символов'),
  dealId: z.string().uuid('Некорректный ID сделки').optional(),
  replyToId: z.string().uuid('Некорректный ID сообщения').optional(),
});

export const editMessageDto = z.object({
  text: z.string().min(1, 'Сообщение не может быть пустым').max(2000, 'Максимум 2000 символов'),
});

export type SendMessageDto = z.infer<typeof sendMessageDto>;
export type EditMessageDto = z.infer<typeof editMessageDto>;
