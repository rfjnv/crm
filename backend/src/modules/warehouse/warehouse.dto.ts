import { z } from 'zod';

/** Ярлыки витрины клиентского бота. SOON показывает товар даже при нулевом остатке. */
export const PRODUCT_BADGES = ['NEW', 'RESTOCK', 'SOON', 'HIT', 'SALE'] as const;

/**
 * PATCH-семантика: ключ, которого нет в теле запроса, обязан остаться `undefined`.
 * Если превратить его в `null`, Prisma запишет NULL — и частичное обновление
 * (переключатель «Активен», установка ярлыка, правка описания) молча сотрёт поле,
 * которого пользователь вообще не касался. Пустая строка — это осознанная очистка.
 */
function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (v === undefined ? undefined : v === '' ? null : v),
    schema.nullable().optional(),
  );
}

function optionalPrice() {
  return z.preprocess(
    (v) => (v === undefined ? undefined : v === '' || v === null ? null : Number(v)),
    z.number().min(0).nullable().optional(),
  );
}

const badgeField = optionalNullable(z.enum(PRODUCT_BADGES));

const badgeUntilField = optionalNullable(z.string());

export const createProductDto = z.object({
  name: z.string().min(1, 'Название товара обязательно'),
  sku: z.string().min(1, 'Артикул обязателен'),
  unit: z.string().default('шт'),
  format: z.string().optional(),
  category: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  minStock: z.number().min(0).default(0),
  purchasePrice: optionalPrice(),
  salePrice: optionalPrice(),
  installmentPrice: optionalPrice(),
  specifications: z.record(z.unknown()).optional(),
  manufacturedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  companyId: z.string().uuid('Некорректный ID компании').optional(),
});

export const updateProductDto = z.object({
  name: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  unit: z.string().optional(),
  format: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  category: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  countryOfOrigin: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  minStock: z.coerce.number().min(0).optional(),
  purchasePrice: optionalPrice(),
  salePrice: optionalPrice(),
  installmentPrice: optionalPrice(),
  specifications: z.record(z.unknown()).nullable().optional(),
  description: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  imageUrl: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  postTextRu: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  postTextUz: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  isActive: z.boolean().optional(),
  badge: badgeField,
  badgeUntil: badgeUntilField,
  manufacturedAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  expiresAt: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
});

export const createMovementDto = z.object({
  productId: z.string().uuid('Некорректный ID товара'),
  type: z.enum(['IN', 'OUT']),
  quantity: z.number().positive('Количество должно быть положительным'),
  dealId: z.string().uuid('Некорректный ID сделки').optional(),
  note: z.string().optional(),
  /** false — записать движение только для истории, не меняя текущий остаток (напр. задним числом восстановить запись о приходе, который уже учтён в остатке). */
  affectStock: z.boolean().optional(),
  /** Кол-во рулонов для товаров с параллельным учётом в рулонах (напр. ламинационная плёнка). Прибавляется к Product.rollStock при типе IN. */
  rollQuantity: z.number().positive('Количество рулонов должно быть положительным').optional(),
});

export const correctStockDto = z.object({
  newStock: z.number().min(0, 'Остаток не может быть отрицательным'),
  reason: z.string().min(1, 'Причина коррекции обязательна'),
  /** Новый остаток в рулонах — только для товаров с параллельным учётом (Product.rollStock не NULL). */
  newRollStock: z.number().min(0, 'Остаток в рулонах не может быть отрицательным').optional(),
});

export const createReservationDto = z.object({
  productId: z.string().uuid('Некорректный ID товара'),
  clientId: z.string().uuid('Некорректный ID клиента'),
  quantity: z.number().positive('Количество должно быть положительным'),
  expiresAt: z.string().datetime('Некорректная дата окончания брони'),
  note: z.string().optional(),
});

export type CreateProductDto = z.infer<typeof createProductDto>;
export type UpdateProductDto = z.infer<typeof updateProductDto>;
export type CreateMovementDto = z.infer<typeof createMovementDto>;
export type CorrectStockDto = z.infer<typeof correctStockDto>;
export type CreateReservationDto = z.infer<typeof createReservationDto>;

export interface ImportedProduct {
  name: string;
  format?: string;
  unit: string;
  stock: number;
}

export interface ImportExcelResult {
  successCount: number;
  errorCount: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: number;
}
