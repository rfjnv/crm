import { z } from 'zod';

const telegramValueSchema = z
  .string()
  .trim()
  .regex(
    /^(@[a-zA-Z0-9_]{5,32}|https?:\/\/t\.me\/[a-zA-Z0-9_]{5,32}|t\.me\/[a-zA-Z0-9_]{5,32}|[a-zA-Z0-9_]{5,32})$/,
    'Некорректный Telegram (пример: @username)',
  );

export const createClientDto = z.object({
  companyName: z.string().min(1, 'Название компании обязательно'),
  contactName: z.string().min(1, 'Контактное лицо обязательно'),
  phone: z.string().optional(),
  email: telegramValueSchema.optional().or(z.literal('')),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
  managerId: z.string().uuid('Некорректный ID менеджера').optional(),
  inn: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  mfo: z.string().optional(),
  vatRegCode: z.string().optional(),
  oked: z.string().optional(),
  portraitProfile: z.string().max(20000).optional(),
  portraitGoals: z.string().max(20000).optional(),
  portraitPains: z.string().max(20000).optional(),
  portraitFears: z.string().max(20000).optional(),
  portraitObjections: z.string().max(20000).optional(),
});

export const updateClientDto = z.object({
  companyName: z.string().min(1).optional(),
  contactName: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: telegramValueSchema.optional().or(z.literal('')),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
  managerId: z.string().uuid('Некорректный ID менеджера').optional(),
  inn: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  mfo: z.string().optional(),
  vatRegCode: z.string().optional(),
  oked: z.string().optional(),
  portraitProfile: z.string().max(20000).optional(),
  portraitGoals: z.string().max(20000).optional(),
  portraitPains: z.string().max(20000).optional(),
  portraitFears: z.string().max(20000).optional(),
  portraitObjections: z.string().max(20000).optional(),
});

export const setClientCreditStatusDto = z.object({
  creditStatus: z.enum(['NORMAL', 'SATISFACTORY', 'NEGATIVE']),
});

export const clientStockQueryDto = z.object({
  historyLimit: z.coerce.number().int().min(1).max(200).optional(),
});

const stockItemBase = z.object({
  productId: z.string().uuid('Некорректный ID товара'),
  qty: z.number().positive('Количество должно быть больше 0'),
  price: z.number().min(0, 'Цена не может быть отрицательной').optional(),
  comment: z.string().max(1000).optional(),
});

export const addClientStockDto = z.object({
  items: z.array(stockItemBase).min(1, 'Добавьте хотя бы один товар'),
});

export const sendClientStockPartialDto = z.object({
  title: z.string().optional(),
  deliveryType: z.enum(['SELF_PICKUP', 'YANDEX', 'DELIVERY']).optional(),
  vehicleNumber: z.string().optional(),
  vehicleType: z.string().optional(),
  deliveryComment: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid('Некорректный ID товара'),
      qty: z.number().positive('Количество должно быть больше 0'),
      price: z.number().min(0, 'Цена не может быть отрицательной').optional(),
      requestComment: z.string().max(1000).optional(),
    }),
  ).min(1, 'Выберите хотя бы одну позицию'),
});

export const sendClientStockAllDto = z.object({
  title: z.string().optional(),
  deliveryType: z.enum(['SELF_PICKUP', 'YANDEX', 'DELIVERY']).optional(),
  vehicleNumber: z.string().optional(),
  vehicleType: z.string().optional(),
  deliveryComment: z.string().optional(),
});

export type CreateClientDto = z.infer<typeof createClientDto>;
export type UpdateClientDto = z.infer<typeof updateClientDto>;
export type SetClientCreditStatusDto = z.infer<typeof setClientCreditStatusDto>;
export type ClientStockQueryDto = z.infer<typeof clientStockQueryDto>;
export type AddClientStockDto = z.infer<typeof addClientStockDto>;
export type SendClientStockPartialDto = z.infer<typeof sendClientStockPartialDto>;
export type SendClientStockAllDto = z.infer<typeof sendClientStockAllDto>;

export const createClientNoteDto = z.object({
  content: z.string().min(1, 'Текст заметки обязателен').max(20000, 'Слишком длинный текст'),
});

export const updateClientNoteDto = z.object({
  content: z.string().min(1, 'Текст заметки обязателен').max(20000, 'Слишком длинный текст'),
});

export type CreateClientNoteDto = z.infer<typeof createClientNoteDto>;
export type UpdateClientNoteDto = z.infer<typeof updateClientNoteDto>;
