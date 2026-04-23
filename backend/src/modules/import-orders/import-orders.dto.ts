import { z } from 'zod';

const currencyEnum = z.enum(['USD', 'EUR', 'CNY', 'RUB', 'UZS']);

export const statusEnum = z.enum([
  'DRAFT', 'ORDERED', 'IN_PRODUCTION', 'SHIPPED',
  'IN_TRANSIT', 'AT_CUSTOMS', 'CLEARED', 'RECEIVED', 'CANCELED',
]);

export const documentTypeEnum = z.enum([
  'INVOICE', 'PACKING_LIST', 'BILL_OF_LADING', 'CMR',
  'CERT_OF_ORIGIN', 'CUSTOMS_DECLARATION', 'SWIFT', 'OTHER',
]);

/** Pipeline: допустимые переходы статусов. CANCELED можно из любого, кроме RECEIVED. */
export const STATUS_PIPELINE: Record<string, string[]> = {
  DRAFT:          ['ORDERED', 'CANCELED'],
  ORDERED:        ['IN_PRODUCTION', 'SHIPPED', 'CANCELED'],
  IN_PRODUCTION:  ['SHIPPED', 'CANCELED'],
  SHIPPED:        ['IN_TRANSIT', 'AT_CUSTOMS', 'CANCELED'],
  IN_TRANSIT:     ['AT_CUSTOMS', 'CANCELED'],
  AT_CUSTOMS:     ['CLEARED', 'CANCELED'],
  CLEARED:        ['RECEIVED', 'CANCELED'],
  RECEIVED:       [],
  CANCELED:       [],
};

const itemSchema = z.object({
  productId: z.string().uuid('Некорректный ID товара'),
  qty: z.number().positive('Кол-во должно быть > 0'),
  unitPrice: z.number().min(0, 'Цена не может быть отрицательной'),
  comment: z.string().optional().nullable(),
});

export const createImportOrderDto = z.object({
  number: z.string().min(1, 'Номер заказа обязателен').max(64),
  supplierId: z.string().uuid('Некорректный ID поставщика'),
  currency: currencyEnum.optional().default('USD'),
  orderDate: z.string().min(1, 'Дата заказа обязательна'),
  etd: z.string().optional().nullable(),
  eta: z.string().optional().nullable(),
  containerNumber: z.string().max(64).optional().nullable(),
  invoiceNumber: z.string().max(64).optional().nullable(),
  invoiceRate: z.number().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).optional().default([]),
});

export const updateImportOrderDto = z.object({
  number: z.string().min(1).max(64).optional(),
  supplierId: z.string().uuid().optional(),
  currency: currencyEnum.optional(),
  orderDate: z.string().optional(),
  etd: z.string().nullable().optional(),
  eta: z.string().nullable().optional(),
  containerNumber: z.string().max(64).nullable().optional(),
  invoiceNumber: z.string().max(64).nullable().optional(),
  invoiceRate: z.number().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const replaceItemsDto = z.object({
  items: z.array(itemSchema),
});

export const changeStatusDto = z.object({
  status: statusEnum,
});

export const uploadAttachmentMetaDto = z.object({
  documentType: documentTypeEnum.optional().default('OTHER'),
});

export type CreateImportOrderDto = z.infer<typeof createImportOrderDto>;
export type UpdateImportOrderDto = z.infer<typeof updateImportOrderDto>;
export type ReplaceItemsDto = z.infer<typeof replaceItemsDto>;
export type ChangeStatusDto = z.infer<typeof changeStatusDto>;
