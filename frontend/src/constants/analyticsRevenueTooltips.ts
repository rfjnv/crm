/**
 * User-facing explanations for operational vs shipped revenue (aligned with backend analytics).
 * RU copy for CRM operators.
 */

/** Stat / primary metric — operational revenue */
export const TOOLTIP_OPERATIONAL_REVENUE =
  'Операционная выручка — сумма строк сделок (сумма строки или количество × цена) по сделкам, которые не отменены и не в архиве. ' +
  'Календарный месяц и день берутся по дате строки сделки; если даты строки нет — по дате создания сделки. ' +
  'Часовой пояс отчёта: Ташкент. Это основной показатель объёма продаж за период.';

/** Stat / secondary metric — shipped & closed line revenue */
export const TOOLTIP_SHIPPED_REVENUE =
  'Отгруженная выручка — те же строки и те же правила даты, но учитываются только сделки в статусе «Отгружено» или «Закрыто». ' +
  'Показывает объём продаж по уже отгруженным/закрытым сделкам; обычно не больше операционной выручки за тот же период.';

/** History monthly series: sum tied to warehouse shipment timestamp */
export const TOOLTIP_SHIPPED_AT_MONTHLY =
  'Сумма строк по фактической дате отгрузки на складе (shipped_at), по месяцу этой даты. ' +
  'Это логистический срез: он может не совпадать с «отгруженной выручкой» по дате строки сделки.';

/** Short labels for chart legend */
export const LEGEND_OPERATIONAL = 'Операционная выручка';
export const LEGEND_SHIPPED_REVENUE = 'Отгружено (закрытые сделки)';
export const LEGEND_PAID = 'Оплачено (по дате платежа)';
export const LEGEND_SHIPPED_AT = 'Склад: по дате отгрузки';
