import { Prisma } from '@prisma/client';

/**
 * Shared Prisma.sql fragments for analytics revenue queries.
 * Convention: queries join `deal_items di` to `deals d` on `d.id = di.deal_id`.
 */

/** IANA timezone string for SQL (Asia/Tashkent). */
export const SQL_ANALYTICS_TZ = Prisma.sql`'Asia/Tashkent'`;

/**
 * Line-level revenue amount (Excel-style: line_total or qty × price).
 */
export const SQL_LINE_REVENUE_DI = Prisma.sql`COALESCE(di.line_total, di.requested_qty * di.price, 0)`;

/** deal_items source_op_type: строки отгрузки со склада клиента (см. clients.service sendStockPartial). */
export const DEAL_ITEM_SOURCE_CLIENT_STOCK = 'CLIENT_STOCK';

/**
 * Выручка по строке сделки для аналитики.
 *
 * Семантика: выручка признаётся ОДИН РАЗ — в момент закрытия сделки, по фактическим строкам.
 * Все строки `deal_items` учитываются равноправно (включая `source_op_type='CLIENT_STOCK'` —
 * отгрузку со склада клиента), без отдельного признания при ADD на склад клиента.
 *
 * Это даёт:
 * – «Выручка по сделкам» = Σ `deals.amount` для CLOSED сделок;
 * – «Выручка по дням» совпадает с суммой реальных закрытых сделок.
 *
 * Раньше CLIENT_STOCK-строки игнорировались, а ADD-события `client_stock_events` суммировались
 * как выручка отдельно. Это приводило к расхождениям, если цена при ADD ≠ цене в строке отгрузки,
 * либо если ADD был, а CLIENT_STOCK сделка ещё не создана/не закрыта.
 */
export const SQL_ANALYTICS_LINE_REVENUE_DI = Prisma.sql`COALESCE(di.line_total, di.requested_qty * di.price, 0)`;

/**
 * Сумма по событию «поступление на склад клиента» (ADD): line_total или qty × unit_price.
 *
 * Используется для отчётов «у клиента на складе» / истории, но НЕ для агрегата выручки —
 * выручка считается только по строкам сделок (см. {@link SQL_ANALYTICS_LINE_REVENUE_DI}).
 */
export const SQL_CLIENT_STOCK_ADD_LINE = Prisma.sql`COALESCE(cse.line_total, ABS(cse.qty_delta) * COALESCE(cse.unit_price, 0), 0)`;

/**
 * Effective timestamp for bucketing line revenue: Excel/import deal_date → день закрытия сделки → создание сделки.
 */
export const SQL_EFFECTIVE_ITEM_TS = Prisma.sql`COALESCE(di.deal_date, d.closed_at, d.created_at)`;

/**
 * Дата строки для выручки в отчётах: открытая сессионная сделка — день позиции (deal_date или создание строки).
 */
export const SQL_EFFECTIVE_REVENUE_ITEM_TS = Prisma.sql`(
  CASE
    WHEN d.is_session_deal = true AND d.status <> 'CLOSED' THEN COALESCE(di.deal_date, di.created_at)
    ELSE COALESCE(di.deal_date, d.closed_at, d.created_at)
  END
)`;

/**
 * Calendar date in Asia/Tashkent for grouping/filtering by local business day.
 */
export const SQL_EFFECTIVE_ITEM_DATE_TASHKENT = Prisma.sql`DATE((${SQL_EFFECTIVE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})`;

/** Как {@link SQL_EFFECTIVE_ITEM_DATE_TASHKENT}, но для выручки (сессионные сделки). */
export const SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT = Prisma.sql`DATE((${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})`;

/**
 * Active deals: not canceled/rejected, not archived (pipeline / non-revenue contexts).
 */
export const SQL_DEALS_ACTIVE_FILTER = Prisma.sql`d.status NOT IN ('CANCELED', 'REJECTED') AND d.is_archived = false`;

/**
 * Revenue analytics: only fully closed deals (line totals from deal_items).
 */
export const SQL_DEALS_CLOSED_REVENUE_FILTER = Prisma.sql`d.status = 'CLOSED' AND d.is_archived = false`;

/**
 * Выручка в аналитике: обычные сделки — только CLOSED; сессионные — все не отменённые,
 * дата строки см. {@link SQL_EFFECTIVE_REVENUE_ITEM_TS}.
 */
export const SQL_DEALS_REVENUE_ANALYTICS_FILTER = Prisma.sql`d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED') AND (
  (NOT d.is_session_deal AND d.status = 'CLOSED')
  OR (d.is_session_deal = true)
)`;

/**
 * @deprecated Use SQL_DEALS_CLOSED_REVENUE_FILTER — revenue counts CLOSED only (not SHIPPED).
 */
export const SQL_DEALS_SHIPPED_CLOSED_FILTER = SQL_DEALS_CLOSED_REVENUE_FILTER;
