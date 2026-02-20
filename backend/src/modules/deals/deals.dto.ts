import { z } from 'zod';

const dealStatuses = [
  'NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED',
  'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT',
  'SHIPMENT_ON_HOLD', 'SHIPPED', 'CLOSED', 'CANCELED', 'REJECTED',
] as const;

export const createDealDto = z.object({
  title: z.string().optional().default(''),
  clientId: z.string().uuid('Некорректный ID клиента'),
  contractId: z.string().uuid('Некорректный ID договора').optional(),
  paymentType: z.enum(['FULL', 'PARTIAL', 'DEBT']).default('FULL'),
  dueDate: z.string().optional(),
  terms: z.string().optional(),
  discount: z.number().min(0).default(0),
  items: z.array(z.object({
    productId: z.string().uuid('Некорректный ID товара'),
    requestedQty: z.number().positive('Количество должно быть положительным').optional(),
    price: z.number().min(0, 'Цена не может быть отрицательной').optional(),
    requestComment: z.string().optional(),
  })).min(1, 'Добавьте хотя бы один товар'),
});

export const updateDealDto = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(dealStatuses).optional(),
  contractId: z.string().uuid().nullable().optional(),
  discount: z.number().min(0).optional(),
  terms: z.string().nullable().optional(),
  managerId: z.string().uuid('Некорректный ID менеджера').optional(),
});

export const paymentDto = z.object({
  paidAmount: z.number().min(0, 'Сумма не может быть отрицательной'),
  paymentType: z.enum(['FULL', 'PARTIAL', 'DEBT']).optional(),
  dueDate: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
});

export const createCommentDto = z.object({
  text: z.string().min(1, 'Комментарий не может быть пустым'),
});

export const addDealItemDto = z.object({
  productId: z.string().uuid('Некорректный ID товара'),
  requestComment: z.string().optional(),
});

export const warehouseResponseDto = z.object({
  items: z.array(z.object({
    dealItemId: z.string().uuid('Некорректный ID позиции'),
    warehouseComment: z.string().min(1, 'Укажите ответ'),
  })).min(1, 'Укажите хотя бы одну позицию'),
});

export const setItemQuantitiesDto = z.object({
  items: z.array(z.object({
    dealItemId: z.string().uuid('Некорректный ID позиции'),
    requestedQty: z.number().positive('Количество должно быть положительным'),
    price: z.number().min(0, 'Цена не может быть отрицательной'),
  })).min(1, 'Укажите хотя бы одну позицию'),
  discount: z.number().min(0, 'Скидка не может быть отрицательной').default(0),
  paymentType: z.enum(['FULL', 'PARTIAL', 'DEBT']).default('FULL'),
  paidAmount: z.number().min(0, 'Сумма не может быть отрицательной').default(0),
  dueDate: z.string().optional(),
  terms: z.string().optional(),
});

export const shipmentDto = z.object({
  vehicleType: z.string().min(1, 'Укажите тип транспорта'),
  vehicleNumber: z.string().min(1, 'Укажите номер транспорта'),
  driverName: z.string().min(1, 'Укажите имя водителя'),
  departureTime: z.string().min(1, 'Укажите время отправки'),
  deliveryNoteNumber: z.string().min(1, 'Укажите номер накладной'),
  shipmentComment: z.string().optional(),
});

export const financeRejectDto = z.object({
  reason: z.string().min(1, 'Укажите причину отклонения'),
});

export const shipmentHoldDto = z.object({
  reason: z.string().min(1, 'Укажите причину приостановки'),
});

export const createPaymentRecordDto = z.object({
  amount: z.number().positive('Сумма должна быть положительной'),
  method: z.string().max(50).optional(),
  note: z.string().max(500).optional(),
  paidAt: z.string().datetime().optional(),
});

export type CreateDealDto = z.infer<typeof createDealDto>;
export type UpdateDealDto = z.infer<typeof updateDealDto>;
export type PaymentDto = z.infer<typeof paymentDto>;
export type CreateCommentDto = z.infer<typeof createCommentDto>;
export type AddDealItemDto = z.infer<typeof addDealItemDto>;
export type WarehouseResponseDto = z.infer<typeof warehouseResponseDto>;
export type SetItemQuantitiesDto = z.infer<typeof setItemQuantitiesDto>;
export type ShipmentDto = z.infer<typeof shipmentDto>;
export type FinanceRejectDto = z.infer<typeof financeRejectDto>;
export type ShipmentHoldDto = z.infer<typeof shipmentHoldDto>;
export type CreatePaymentRecordDto = z.infer<typeof createPaymentRecordDto>;
