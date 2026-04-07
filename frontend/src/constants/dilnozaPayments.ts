import type { PaymentMethod } from '../types';

/** Все способы оплаты для быстрого выбора при создании сделки (Дилноза) */
export const DILNOZA_PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Наличные' },
  { value: 'PAYME', label: 'Payme' },
  { value: 'QR', label: 'QR' },
  { value: 'CLICK', label: 'Click' },
  { value: 'TERMINAL', label: 'Терминал' },
  { value: 'TRANSFER', label: 'Перечисление' },
  { value: 'INSTALLMENT', label: 'Рассрочка' },
];

/** Перечисление и рассрочка — те же поля, что у «Отправить в финансы» (ИНН, документы) */
export function needsDilnozaTransferFields(method: PaymentMethod): boolean {
  return method === 'TRANSFER' || method === 'INSTALLMENT';
}

export type DilnozaDealsPaymentFilter = 'ALL' | PaymentMethod | 'ACCOUNTING';

export const DILNOZA_DEALS_FILTER_OPTIONS: { label: string; value: DilnozaDealsPaymentFilter }[] = [
  { label: 'Все оплаты', value: 'ALL' },
  ...DILNOZA_PAYMENT_METHOD_OPTIONS.map(({ value, label }) => ({ value, label })),
  { label: 'Бухгалтерия', value: 'ACCOUNTING' },
];
