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

/**
 * Effective timestamp for bucketing line revenue: business deal_date when set, else deal creation time.
 */
export const SQL_EFFECTIVE_ITEM_TS = Prisma.sql`COALESCE(di.deal_date, d.created_at)`;

/**
 * Calendar date in Asia/Tashkent for grouping/filtering by local business day.
 */
export const SQL_EFFECTIVE_ITEM_DATE_TASHKENT = Prisma.sql`DATE((${SQL_EFFECTIVE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})`;

/**
 * Active deals: included in default (operational) revenue — not canceled/rejected, not archived.
 */
export const SQL_DEALS_ACTIVE_FILTER = Prisma.sql`d.status NOT IN ('CANCELED', 'REJECTED') AND d.is_archived = false`;

/**
 * Shipped/closed deals only — for “shipped revenue” metric (not used in dashboard yet).
 */
export const SQL_DEALS_SHIPPED_CLOSED_FILTER = Prisma.sql`d.status IN ('SHIPPED', 'CLOSED') AND d.is_archived = false`;
