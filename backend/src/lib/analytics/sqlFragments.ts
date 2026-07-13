import { Prisma, DealStatus } from '@prisma/client';

/**
 * Shared Prisma.sql fragments for analytics revenue queries.
 * Convention: queries join `deal_items di` to `deals d` on `d.id = di.deal_id`.
 */

/** IANA timezone string for SQL (Asia/Tashkent). */
export const SQL_ANALYTICS_TZ = Prisma.sql`'Asia/Tashkent'`;

/**
 * Line-level revenue amount (Excel-style: line_total or qty × price).
 *
 * NULLIF(di.line_total, 0): храним line_total как «истину», НО если он равен 0
 * (импорт/цех-сделки иногда пишут line_total=0 при реальных qty/price), это ложный
 * ноль — тогда падаем на qty × price. Иначе такая строка занижала бы выручку до 0,
 * хотя у сделки есть корректная сумма (см. баг: «ламинация цех», line_total=0).
 */
export const SQL_LINE_REVENUE_DI = Prisma.sql`COALESCE(NULLIF(di.line_total, 0), di.requested_qty * di.price, 0)`;

/** deal_items source_op_type: строки отгрузки со склада клиента (см. clients.service sendStockPartial). */
export const DEAL_ITEM_SOURCE_CLIENT_STOCK = 'CLIENT_STOCK';

/**
 * Выручка по строке сделки для аналитики.
 *
 * Семантика: выручка признаётся ОДИН РАЗ — по фактическим строкам, начиная с момента,
 * когда зав.склада отправляет сделку на одобрение админу (см. {@link SQL_DEALS_CLOSED_REVENUE_FILTER}).
 * Все строки `deal_items` учитываются равноправно (включая `source_op_type='CLIENT_STOCK'` —
 * отгрузку со склада клиента), без отдельного признания при ADD на склад клиента.
 *
 * Это даёт:
 * – «Выручка по сделкам» = Σ `deals.amount` для сделок PENDING_ADMIN и позже (см. фильтр ниже);
 * – «Выручка по дням» совпадает с суммой реальных сделок, отправленных на одобрение или далее.
 *
 * Раньше CLIENT_STOCK-строки игнорировались, а ADD-события `client_stock_events` суммировались
 * как выручка отдельно. Это приводило к расхождениям, если цена при ADD ≠ цене в строке отгрузки,
 * либо если ADD был, а CLIENT_STOCK сделка ещё не создана/не закрыта.
 */
export const SQL_ANALYTICS_LINE_REVENUE_DI = Prisma.sql`COALESCE(NULLIF(di.line_total, 0), di.requested_qty * di.price, 0)`;

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
 * ВРЕМЕННОЕ ИЗМЕНЕНИЕ (2026-07-11): выручка признаётся не после закрытия (CLOSED),
 * а сразу как зав.склада отправляет сделку на одобрение админу (PENDING_ADMIN) — и на
 * всех статусах дальше по цепочке одобрения/отгрузки/доставки. Раньше было только CLOSED.
 * Используй этот массив в Prisma-билдере (`status: { in: REVENUE_DEAL_STATUSES }`),
 * а {@link SQL_DEALS_REVENUE_STATUSES} — в сырых SQL-запросах.
 */
export const REVENUE_DEAL_STATUSES: DealStatus[] = [
  'PENDING_ADMIN', 'READY_FOR_LOADING', 'LOADING_ASSIGNED', 'READY_FOR_DELIVERY', 'IN_DELIVERY', 'CLOSED',
];

/**
 * ВАЖНО: литерал, а не Prisma.join(...) — d.status это Postgres enum (deal_status).
 * Prisma.join биндит значения как параметры типа text, а Postgres не даёт неявного
 * оператора `deal_status = text`, что валило все запросы с этим фильтром ошибкой 500
 * (operator does not exist: deal_status = text). Значения статичны (наш enum), поэтому
 * инлайнить их как SQL-литералы безопасно — как и в SQL_DEALS_ACTIVE_FILTER выше.
 */
export const SQL_DEALS_REVENUE_STATUSES = Prisma.raw(
  REVENUE_DEAL_STATUSES.map((s) => `'${s}'`).join(', '),
);

/**
 * Revenue analytics: deals sent to admin for approval or further along (see
 * {@link SQL_DEALS_REVENUE_STATUSES} — временное изменение, см. комментарий там).
 */
export const SQL_DEALS_CLOSED_REVENUE_FILTER = Prisma.sql`d.status IN (${SQL_DEALS_REVENUE_STATUSES}) AND d.is_archived = false`;

/**
 * Выручка в аналитике: обычные сделки — PENDING_ADMIN и далее (см. {@link SQL_DEALS_REVENUE_STATUSES});
 * сессионные — все не отменённые, дата строки см. {@link SQL_EFFECTIVE_REVENUE_ITEM_TS}.
 */
export const SQL_DEALS_REVENUE_ANALYTICS_FILTER = Prisma.sql`d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED') AND (
  (NOT d.is_session_deal AND d.status IN (${SQL_DEALS_REVENUE_STATUSES}))
  OR (d.is_session_deal = true)
)`;

/**
 * @deprecated Use SQL_DEALS_CLOSED_REVENUE_FILTER — revenue counts PENDING_ADMIN+ (not just CLOSED/SHIPPED).
 */
export const SQL_DEALS_SHIPPED_CLOSED_FILTER = SQL_DEALS_CLOSED_REVENUE_FILTER;
