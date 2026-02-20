import { z } from 'zod';

export const createProductDto = z.object({
  name: z.string().min(1, 'Название товара обязательно'),
  sku: z.string().min(1, 'Артикул обязателен'),
  unit: z.string().default('шт'),
  format: z.string().optional(),
  category: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  minStock: z.number().min(0).default(0),
  purchasePrice: z.number().min(0).optional(),
  salePrice: z.number().min(0).optional(),
  installmentPrice: z.number().min(0).optional(),
  specifications: z.record(z.unknown()).optional(),
  manufacturedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const updateProductDto = z.object({
  name: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  unit: z.string().optional(),
  format: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  category: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  countryOfOrigin: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  minStock: z.number().min(0).optional(),
  purchasePrice: z.number().min(0).nullable().optional(),
  salePrice: z.number().min(0).nullable().optional(),
  installmentPrice: z.number().min(0).nullable().optional(),
  specifications: z.record(z.unknown()).nullable().optional(),
  isActive: z.boolean().optional(),
  manufacturedAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  expiresAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
});

export const createMovementDto = z.object({
  productId: z.string().uuid('Некорректный ID товара'),
  type: z.enum(['IN', 'OUT']),
  quantity: z.number().positive('Количество должно быть положительным'),
  dealId: z.string().uuid('Некорректный ID сделки').optional(),
  note: z.string().optional(),
});

export type CreateProductDto = z.infer<typeof createProductDto>;
export type UpdateProductDto = z.infer<typeof updateProductDto>;
export type CreateMovementDto = z.infer<typeof createMovementDto>;
