/**
 * User-facing explanations for revenue analytics (aligned with backend: CLOSED deals, deal_items line totals).
 */

/** Primary revenue — closed deals only */
export const TOOLTIP_OPERATIONAL_REVENUE =
  'Выручка — сумма строк сделок (строка или количество × цена) только по сделкам в статусе «Закрыто». ' +
  'Отменённые, черновики и незакрытые сделки не входят. ' +
  'День/месяц: дата строки сделки (deal_date), иначе дата создания сделки; часовой пояс Ташкент.';

/** Legacy label: same as operational (both metrics use CLOSED-only line revenue). */
export const TOOLTIP_SHIPPED_REVENUE =
  'Совпадает с основной выручкой: учитываются только закрытые сделки, только строки deal_items.';

/** History monthly series: sum tied to warehouse shipment timestamp */
export const TOOLTIP_SHIPPED_AT_MONTHLY =
  'Сумма строк по фактической дате отгрузки на складе (shipped_at), по месяцу этой даты. ' +
  'Это логистический срез: он может не совпадать с выручкой по дате строки сделки.';

/** Short labels for chart legend */
export const LEGEND_OPERATIONAL = 'Выручка (закрытые сделки)';
export const LEGEND_SHIPPED_REVENUE = 'Выручка (закрытые сделки)';
export const LEGEND_PAID = 'Оплачено (по дате платежа)';
export const LEGEND_SHIPPED_AT = 'Склад: по дате отгрузки';
