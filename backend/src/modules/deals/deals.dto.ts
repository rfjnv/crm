import { z } from 'zod';

const dealStatuses = [
  'NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED',
  'WAITING_FINANCE', 'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT',
  'SHIPMENT_ON_HOLD', 'CLOSED', 'CANCELED', 'REJECTED',
  'WAITING_WAREHOUSE_MANAGER', 'PENDING_ADMIN', 'READY_FOR_LOADING',
  'LOADING_ASSIGNED', 'READY_FOR_DELIVERY', 'IN_DELIVERY',
] as const;

export const createDealDto = z.object({
  title: z.string().optional().default(''),
  clientId: z.string().uuid('Некорректный ID клиента'),
  comment: z.string().optional(),
  deliveryType: z.enum(['SELF_PICKUP', 'YANDEX', 'DELIVERY']).optional(),
  vehicleNumber: z.string().optional(),
  vehicleType: z.string().optional(),
  deliveryComment: z.string().optional(),
  paymentMethod: z.enum(['CASH', 'PAYME', 'QR', 'TRANSFER', 'CLICK', 'TERMINAL', 'INSTALLMENT']).optional(),
  /** Dilnoza: комментарий / номер операции для способов без перечисления (в terms) */
  paymentNote: z.string().optional(),
  /** @deprecated предпочтительно paymentNote */
  cashNote: z.string().optional(),
  /** @deprecated предпочтительно paymentNote */
  clickTransactionId: z.string().optional(),
  /** Dilnoza: перечисление — как send-to-finance */
  transferInn: z.string().optional(),
  transferDocuments: z.array(z.string()).optional(),
  transferType: z.enum(['ONE_TIME', 'ANNUAL']).optional(),
  items: z.array(z.object({
    productId: z.string().uuid('Некорректный ID товара'),
    requestedQty: z.number().positive('Количество должно быть положительным').optional(),
    price: z.number().min(0, 'Цена не может быть отрицательной').optional(),
    requestComment: z.string().optional(),
  })).min(1, 'Добавьте хотя бы один товар'),
}).refine((data) => {
  return data.items.every((item) => {
    if (item.requestedQty && item.requestedQty > 0) {
      return item.price != null && item.price > 0;
    }
    return true;
  });
}, { message: 'Если указано количество, цена обязательна и должна быть больше 0' });

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
  paymentType: z.enum(['FULL', 'PARTIAL', 'INSTALLMENT']).optional(),
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
  paymentType: z.enum(['FULL', 'PARTIAL', 'INSTALLMENT']).default('FULL'),
  paidAmount: z.number().min(0, 'Сумма не может быть отрицательной').default(0),
  dueDate: z.string().optional(),
  terms: z.string().optional(),
  includeVat: z.boolean().default(true),
});

export const sendToFinanceDto = z.object({
  paymentMethod: z.enum(['CASH', 'PAYME', 'QR', 'TRANSFER', 'CLICK', 'TERMINAL', 'INSTALLMENT']),
  transferInn: z.string().optional(),
  transferDocuments: z.array(z.string()).optional(),
  transferType: z.enum(['ONE_TIME', 'ANNUAL']).optional(),
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
  method: z.enum(['CASH', 'TRANSFER', 'PAYME', 'QR', 'CLICK', 'TERMINAL', 'INSTALLMENT']).optional(),
  note: z.string().max(500).optional(),
  paidAt: z.string().datetime().optional(),
});

export const updatePaymentRecordDto = z.object({
  amount: z.number().positive('Сумма должна быть положительной').optional(),
  method: z.enum(['CASH', 'TRANSFER', 'PAYME', 'QR', 'CLICK', 'TERMINAL', 'INSTALLMENT']).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  paidAt: z.string().datetime().optional(),
});

export type CreateDealDto = z.infer<typeof createDealDto>;
export type UpdateDealDto = z.infer<typeof updateDealDto>;
export type PaymentDto = z.infer<typeof paymentDto>;
export type CreateCommentDto = z.infer<typeof createCommentDto>;
export type AddDealItemDto = z.infer<typeof addDealItemDto>;
export type WarehouseResponseDto = z.infer<typeof warehouseResponseDto>;
export type SetItemQuantitiesDto = z.infer<typeof setItemQuantitiesDto>;
export type SendToFinanceDto = z.infer<typeof sendToFinanceDto>;
export type ShipmentDto = z.infer<typeof shipmentDto>;
export type FinanceRejectDto = z.infer<typeof financeRejectDto>;
export type ShipmentHoldDto = z.infer<typeof shipmentHoldDto>;
export type CreatePaymentRecordDto = z.infer<typeof createPaymentRecordDto>;
export type UpdatePaymentRecordDto = z.infer<typeof updatePaymentRecordDto>;

// ──── SUPER_ADMIN Override ────

export const superOverrideDealDto = z.object({
  reason: z.string().min(3, 'Укажите причину изменения (мин. 3 символа)'),
  title: z.string().min(1).optional(),
  status: z.enum(dealStatuses).optional(),
  clientId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  contractId: z.string().uuid().nullable().optional(),
  paymentMethod: z.enum(['CASH', 'TRANSFER', 'PAYME', 'QR', 'CLICK', 'TERMINAL', 'INSTALLMENT']).nullable().optional(),
  paymentType: z.enum(['FULL', 'PARTIAL', 'INSTALLMENT']).optional(),
  paidAmount: z.number().min(0).optional(),
  dueDate: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  /** Дата закрытия / доставки сделки (факт) */
  closedAt: z.string().nullable().optional(),
  discount: z.number().min(0).optional(),
  terms: z.string().nullable().optional(),
  deliveryType: z.enum(['SELF_PICKUP', 'YANDEX', 'DELIVERY']).nullable().optional(),
  vehicleNumber: z.string().nullable().optional(),
  vehicleType: z.string().nullable().optional(),
  deliveryComment: z.string().nullable().optional(),
  loadingAssigneeId: z.string().uuid().nullable().optional(),
  deliveryDriverId: z.string().uuid().nullable().optional(),
  items: z.array(z.object({
    id: z.string().uuid().optional(),
    productId: z.string().uuid(),
    requestedQty: z.number().positive().optional(),
    price: z.number().min(0).optional(),
    requestComment: z.string().optional(),
    warehouseComment: z.string().optional(),
    dealDate: z.string().nullable().optional(),
    confirmedAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    shippedAt: z.string().nullable().optional(),
    deliveredAt: z.string().nullable().optional(),
  })).optional(),
  payments: z.array(z.object({
    id: z.string().uuid(),
    paidAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
  })).optional(),
  comments: z.array(z.object({
    id: z.string().uuid(),
    createdAt: z.string().nullable().optional(),
  })).optional(),
  shipment: z.object({
    vehicleType: z.string().min(1),
    vehicleNumber: z.string().min(1),
    driverName: z.string().min(1),
    departureTime: z.string().min(1),
    deliveryNoteNumber: z.string().min(1),
    shipmentComment: z.string().optional(),
    shippedAt: z.string().nullable().optional(),
  }).optional(),
});

export const superDeleteDealDto = z.object({
  reason: z.string().min(3, 'Укажите причину удаления (мин. 3 символа)'),
});

// ──── Warehouse Manager: confirm deal for admin ────
export const warehouseManagerConfirmDto = z.object({
  comment: z.string().optional(),
});

// ──── Warehouse Manager: assign loading employee ────
export const assignLoadingDto = z.object({
  assigneeId: z.string().uuid('Укажите сотрудника'),
});

// ──── Employee: mark as loaded ────
export const markLoadedDto = z.object({
  comment: z.string().optional(),
});

// ──── Warehouse Manager: assign delivery driver ────
export const assignDriverDto = z.object({
  driverId: z.string().uuid('Укажите водителя'),
});

// ──── Driver: start delivery ────
export const startDeliveryDto = z.object({
  dealIds: z.array(z.string().uuid()).min(1, 'Укажите хотя бы одну сделку'),
});

export type SuperOverrideDealDto = z.infer<typeof superOverrideDealDto>;
export type SuperDeleteDealDto = z.infer<typeof superDeleteDealDto>;
export type WarehouseManagerConfirmDto = z.infer<typeof warehouseManagerConfirmDto>;
export type AssignLoadingDto = z.infer<typeof assignLoadingDto>;
export type MarkLoadedDto = z.infer<typeof markLoadedDto>;
export type AssignDriverDto = z.infer<typeof assignDriverDto>;
export type StartDeliveryDto = z.infer<typeof startDeliveryDto>;
