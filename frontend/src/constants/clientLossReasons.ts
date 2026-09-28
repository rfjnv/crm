/** Почему клиент перестал покупать. null у клиента — не потерян. */
export type ClientLossReason = 'NO_CREDIT' | 'PRICE' | 'NO_PRODUCT' | 'LOGISTICS' | 'COMPETITOR' | 'UNKNOWN';

export const CLIENT_LOSS_REASONS: { value: ClientLossReason; emoji: string; short: string; label: string }[] = [
  { value: 'NO_CREDIT', emoji: '💳', short: 'Нет отсрочки', label: 'Нет отсрочки / отказ в товарном кредите' },
  { value: 'PRICE', emoji: '💰', short: 'Цена', label: 'Цена' },
  { value: 'NO_PRODUCT', emoji: '📦', short: 'Нет товара', label: 'Нет нужного товара' },
  { value: 'LOGISTICS', emoji: '🚚', short: 'Логистика', label: 'Логистика / доставка' },
  { value: 'COMPETITOR', emoji: '🤝', short: 'К конкуренту', label: 'Ушёл к конкуренту' },
  { value: 'UNKNOWN', emoji: '😐', short: 'Неизвестно', label: 'Неизвестно' },
];

export const CLIENT_LOSS_REASON_META = Object.fromEntries(
  CLIENT_LOSS_REASONS.map((r) => [r.value, r]),
) as Record<ClientLossReason, (typeof CLIENT_LOSS_REASONS)[number]>;
