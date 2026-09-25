import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_EXCLUDE_INTERNAL_COMPANY_PRODUCT,
  INTERNAL_COMPANY_NAME,
} from '../../lib/analytics';
import { normalizeSku } from '../market/marketCatalogLinks';

/**
 * Аналитика для раздачи задач: кто перестал покупать, кто брал товар, который
 * сейчас лежит на складе, и что залежалось. Всё только читает.
 *
 * «Покупка» — день, в который у клиента была продажа (строки одной даты в разных
 * сделках — одна покупка): иначе клиент с тремя сделками за утро выглядел бы
 * покупающим раз в ноль дней.
 */

const clamp = (v: number | undefined, def: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(v ?? def), min), max);

/** Интервал короче недели не считаем «обычным»: частым покупателям пара тихих дней ничего не значит. */
const MIN_CYCLE_DAYS = 7;

/** Строки продаж с датой по Ташкенту, без внутренней компании. Нужен алиас выборки `lines`. */
const SALES_LINES = Prisma.sql`
  SELECT d.client_id, di.product_id, di.requested_qty AS qty,
    ${SQL_ANALYTICS_LINE_REVENUE_DI} AS revenue,
    DATE((${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent') AS day
  FROM deal_items di
  JOIN deals d ON d.id = di.deal_id
  WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}`;

const TODAY = Prisma.sql`(NOW() AT TIME ZONE 'Asia/Tashkent')::date`;

/** Последний контакт с клиентом: заметка или звонок. */
const LAST_CONTACT = Prisma.sql`
  SELECT client_id, MAX(at) AS last_contact_at FROM (
    SELECT client_id, created_at AS at FROM client_notes WHERE deleted_at IS NULL
    UNION ALL
    SELECT client_id, started_at AS at FROM call_sessions WHERE client_id IS NOT NULL
  ) x GROUP BY client_id`;

const ACTIVE_CLIENT = Prisma.sql`c.is_archived = false AND NOT EXISTS (
  SELECT 1 FROM companies ico WHERE ico.id = c.company_id AND ico.name = ${INTERNAL_COMPANY_NAME}
)`;

// ─── Цикл покупок клиента ───────────────────────────────────────────────────

export type CycleStatus = 'regular' | 'due_soon' | 'overdue' | 'lost';

export type ClientCyclesInput = {
  status?: CycleStatus | 'all';
  manager_id?: string;
  min_orders?: number;
  overdue_factor?: number;
  lost_after_days?: number;
  limit?: number;
};

type ClientCycleRow = {
  client_id: string;
  client: string;
  phone: string | null;
  manager_id: string;
  manager: string;
  orders: number;
  first_order: string;
  last_order: string;
  days_since: number;
  cycle_days: number;
  revenue_12m: number;
  revenue_total: number;
  last_contact_at: string | null;
};

/**
 * Клиенты с их обычным интервалом между покупками (медиана) и статусом:
 * regular — ещё рано; due_soon — пора покупать (от 0,8 интервала до порога «пропал»);
 * overdue — пропал: прошло больше overdue_factor интервалов; lost — давно ушёл
 * (больше lost_after_days дней и больше четырёх интервалов).
 */
export async function clientPurchaseCycles(input: ClientCyclesInput) {
  const minOrders = clamp(input.min_orders, 3, 2, 100);
  const factor = Math.min(Math.max(input.overdue_factor ?? 1.5, 1.1), 5);
  const lostAfter = clamp(input.lost_after_days, 180, 60, 1095);
  const limit = clamp(input.limit, 50, 1, 200);
  const status = input.status ?? 'all';

  const ratio = Prisma.sql`(s.days_since::numeric / GREATEST(s.cycle_days, ${MIN_CYCLE_DAYS}))`;
  const statusSql = Prisma.sql`CASE
      WHEN s.days_since > ${lostAfter} AND ${ratio} > 4 THEN 'lost'
      WHEN ${ratio} > ${factor} THEN 'overdue'
      WHEN ${ratio} >= 0.8 THEN 'due_soon'
      ELSE 'regular' END`;
  const filters: Prisma.Sql[] = [ACTIVE_CLIENT, Prisma.sql`s.orders >= ${minOrders}`];
  if (input.manager_id) filters.push(Prisma.sql`c.manager_id = ${input.manager_id}`);

  const rows = await prisma.$queryRaw<(ClientCycleRow & { status: CycleStatus; overdue_ratio: number })[]>(Prisma.sql`
    WITH lines AS (${SALES_LINES}),
    days AS (
      SELECT client_id, day, SUM(revenue) AS revenue FROM lines GROUP BY client_id, day
    ),
    gaps AS (
      SELECT client_id, day, revenue, day - LAG(day) OVER (PARTITION BY client_id ORDER BY day) AS gap FROM days
    ),
    s AS (
      SELECT client_id,
        COUNT(*)::int AS orders,
        MIN(day) AS first_order,
        MAX(day) AS last_order,
        (${TODAY} - MAX(day))::int AS days_since,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) FILTER (WHERE gap IS NOT NULL), 0)::float8 AS cycle_days,
        COALESCE(SUM(revenue) FILTER (WHERE day >= ${TODAY} - 365), 0)::float8 AS revenue_12m,
        COALESCE(SUM(revenue), 0)::float8 AS revenue_total
      FROM gaps GROUP BY client_id
    ),
    lc AS (${LAST_CONTACT}),
    ranked AS (
      SELECT c.id AS client_id, c.company_name AS client, c.phone, c.manager_id, u.full_name AS manager,
        s.orders, to_char(s.first_order, 'YYYY-MM-DD') AS first_order, to_char(s.last_order, 'YYYY-MM-DD') AS last_order,
        s.days_since, ROUND(s.cycle_days::numeric, 1)::float8 AS cycle_days,
        ROUND((${ratio})::numeric, 2)::float8 AS overdue_ratio,
        s.revenue_12m, s.revenue_total,
        to_char(lc.last_contact_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS last_contact_at,
        ${statusSql} AS status
      FROM s
      JOIN clients c ON c.id = s.client_id
      JOIN users u ON u.id = c.manager_id
      LEFT JOIN lc ON lc.client_id = c.id
      WHERE ${Prisma.join(filters, ' AND ')}
    )
    SELECT * FROM ranked
    ${status === 'all' ? Prisma.empty : Prisma.sql`WHERE status = ${status}`}
    ORDER BY revenue_12m DESC, revenue_total DESC
    LIMIT ${limit}`);

  const topProducts = await topProductsByClient(rows.map((r) => r.client_id));
  return {
    rules: {
      min_orders: minOrders,
      overdue_factor: factor,
      lost_after_days: lostAfter,
      note: 'cycle_days — медиана дней между покупками (не меньше 7 при расчёте статуса); overdue_ratio — сколько интервалов прошло с последней покупки.',
    },
    clients: rows.map((r) => ({ ...r, top_products_12m: topProducts.get(r.client_id) ?? [] })),
  };
}

/** Три главных товара клиента за год — чтобы было что предложить. */
async function topProductsByClient(clientIds: string[]) {
  const out = new Map<string, { product: string; qty: number; unit: string | null }[]>();
  if (!clientIds.length) return out;
  const rows = await prisma.$queryRaw<{ client_id: string; product: string; unit: string | null; qty: number }[]>(Prisma.sql`
    WITH lines AS (${SALES_LINES}),
    agg AS (
      SELECT l.client_id, l.product_id, SUM(l.qty)::float8 AS qty, SUM(l.revenue) AS revenue,
        ROW_NUMBER() OVER (PARTITION BY l.client_id ORDER BY SUM(l.revenue) DESC) AS rn
      FROM lines l
      WHERE l.client_id = ANY(${clientIds}) AND l.day >= ${TODAY} - 365
      GROUP BY l.client_id, l.product_id
    )
    SELECT a.client_id, p.name AS product, p.unit, a.qty
    FROM agg a JOIN products p ON p.id = a.product_id
    WHERE a.rn <= 3
    ORDER BY a.client_id, a.rn`);
  for (const r of rows) {
    const list = out.get(r.client_id) ?? [];
    list.push({ product: r.product, qty: r.qty, unit: r.unit });
    out.set(r.client_id, list);
  }
  return out;
}

// ─── Постоянные покупатели товара, который есть на складе ───────────────────

export type StockedProductBuyersInput = {
  search?: string;
  category?: string;
  skus?: string[];
  min_purchases?: number;
  overdue_factor?: number;
  include_active?: boolean;
  limit_products?: number;
  limit_buyers?: number;
};

/**
 * Товары в наличии и клиенты, которые брали их регулярно, но давно не берут.
 * «Давно» — прошло больше overdue_factor их обычных интервалов покупки этого
 * товара (не меньше 30 дней). include_active=true вернёт и тех, кто берёт как обычно.
 */
export async function stockedProductBuyers(input: StockedProductBuyersInput) {
  const minPurchases = clamp(input.min_purchases, 3, 2, 100);
  const factor = Math.min(Math.max(input.overdue_factor ?? 1.5, 1.1), 5);
  const limitProducts = clamp(input.limit_products, 20, 1, 50);
  const limitBuyers = clamp(input.limit_buyers, 15, 1, 50);

  const productFilters: Prisma.Sql[] = [
    Prisma.sql`p.is_active = true`,
    Prisma.sql`p.stock > 0`,
    SQL_EXCLUDE_INTERNAL_COMPANY_PRODUCT,
  ];
  if (input.search?.trim()) {
    const q = `%${input.search.trim()}%`;
    productFilters.push(Prisma.sql`(p.name ILIKE ${q} OR p.sku ILIKE ${q})`);
  }
  if (input.category?.trim()) productFilters.push(Prisma.sql`p.category ILIKE ${`%${input.category.trim()}%`}`);
  if (input.skus?.length) productFilters.push(Prisma.sql`LOWER(TRIM(p.sku)) = ANY(${input.skus.map(normalizeSku)})`);

  const silentSql = Prisma.sql`(b.days_since > GREATEST(${factor} * GREATEST(b.cycle_days, ${MIN_CYCLE_DAYS}), 30))`;

  const rows = await prisma.$queryRaw<{
    product_id: string; product: string; sku: string; unit: string | null; stock: number; sale_price: number | null;
    client_id: string; client: string; phone: string | null; manager_id: string; manager: string;
    purchases: number; qty_total: number; typical_qty: number; last_bought: string; days_since: number;
    cycle_days: number; silent: boolean; buyer_rank: number;
  }[]>(Prisma.sql`
    WITH lines AS (${SALES_LINES}),
    pd AS (
      SELECT client_id, product_id, day, SUM(qty) AS qty FROM lines
      WHERE product_id IN (SELECT p.id FROM products p WHERE ${Prisma.join(productFilters, ' AND ')})
      GROUP BY client_id, product_id, day
    ),
    g AS (
      SELECT *, day - LAG(day) OVER (PARTITION BY client_id, product_id ORDER BY day) AS gap FROM pd
    ),
    b AS (
      SELECT client_id, product_id, COUNT(*)::int AS purchases, SUM(qty)::float8 AS qty_total,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY qty))::float8 AS typical_qty,
        MAX(day) AS last_bought, (${TODAY} - MAX(day))::int AS days_since,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) FILTER (WHERE gap IS NOT NULL), 0)::float8 AS cycle_days
      FROM g GROUP BY client_id, product_id
      HAVING COUNT(*) >= ${minPurchases}
    ),
    picked AS (
      SELECT b.*, ${silentSql} AS silent,
        ROW_NUMBER() OVER (PARTITION BY b.product_id ORDER BY b.qty_total DESC) AS buyer_rank
      FROM b JOIN clients c ON c.id = b.client_id
      WHERE ${ACTIVE_CLIENT} ${input.include_active ? Prisma.empty : Prisma.sql`AND ${silentSql}`}
    ),
    top_products AS (
      SELECT product_id, SUM(qty_total) AS lost_qty FROM picked GROUP BY product_id
      ORDER BY lost_qty DESC LIMIT ${limitProducts}
    )
    SELECT p.id AS product_id, p.name AS product, p.sku, p.unit, p.stock::float8 AS stock, p.sale_price::float8 AS sale_price,
      c.id AS client_id, c.company_name AS client, c.phone, c.manager_id, u.full_name AS manager,
      k.purchases, k.qty_total, k.typical_qty, to_char(k.last_bought, 'YYYY-MM-DD') AS last_bought, k.days_since,
      ROUND(k.cycle_days::numeric, 1)::float8 AS cycle_days, k.silent, k.buyer_rank::int
    FROM picked k
    JOIN top_products t ON t.product_id = k.product_id
    JOIN products p ON p.id = k.product_id
    JOIN clients c ON c.id = k.client_id
    JOIN users u ON u.id = c.manager_id
    WHERE k.buyer_rank <= ${limitBuyers}
    ORDER BY t.lost_qty DESC, p.id, k.buyer_rank`);

  const products = new Map<string, { product_id: string; product: string; sku: string; unit: string | null; stock: number; sale_price: number | null; buyers: unknown[] }>();
  for (const r of rows) {
    const p = products.get(r.product_id) ?? {
      product_id: r.product_id, product: r.product, sku: r.sku, unit: r.unit, stock: r.stock, sale_price: r.sale_price, buyers: [],
    };
    p.buyers.push({
      client_id: r.client_id, client: r.client, phone: r.phone, manager_id: r.manager_id, manager: r.manager,
      purchases: r.purchases, typical_qty: r.typical_qty, qty_total: r.qty_total,
      last_bought: r.last_bought, days_since: r.days_since, cycle_days: r.cycle_days, silent: r.silent,
    });
    products.set(r.product_id, p);
  }
  return {
    rules: { min_purchases: minPurchases, overdue_factor: factor, only_silent: !input.include_active },
    products: [...products.values()],
  };
}

// ─── Залежавшийся товар ─────────────────────────────────────────────────────

export type SlowStockInput = {
  days_without_sale?: number;
  category?: string;
  limit?: number;
  buyers_per_product?: number;
};

/**
 * Товар в наличии без продаж N дней (или никогда не продававшийся) — с суммой,
 * замороженной по закупке, и прошлыми покупателями, которым его можно предложить.
 */
export async function slowStock(input: SlowStockInput) {
  const days = clamp(input.days_without_sale, 60, 14, 730);
  const limit = clamp(input.limit, 30, 1, 100);
  const buyersPer = clamp(input.buyers_per_product, 5, 0, 20);
  const filters: Prisma.Sql[] = [Prisma.sql`p.is_active = true`, Prisma.sql`p.stock > 0`, SQL_EXCLUDE_INTERNAL_COMPANY_PRODUCT];
  if (input.category?.trim()) filters.push(Prisma.sql`p.category ILIKE ${`%${input.category.trim()}%`}`);

  const products = await prisma.$queryRaw<{
    product_id: string; product: string; sku: string; unit: string | null; category: string | null;
    stock: number; sale_price: number | null; purchase_price: number | null; frozen_by_purchase: number | null;
    last_sale: string | null; days_since_sale: number | null; sold_qty_12m: number;
  }[]>(Prisma.sql`
    WITH lines AS (${SALES_LINES}),
    last_sale AS (
      SELECT product_id, MAX(day) AS last_day,
        COALESCE(SUM(qty) FILTER (WHERE day >= ${TODAY} - 365), 0)::float8 AS qty_12m
      FROM lines GROUP BY product_id
    )
    SELECT p.id AS product_id, p.name AS product, p.sku, p.unit, p.category,
      p.stock::float8 AS stock, p.sale_price::float8 AS sale_price, p.purchase_price::float8 AS purchase_price,
      (p.stock * p.purchase_price)::float8 AS frozen_by_purchase,
      to_char(ls.last_day, 'YYYY-MM-DD') AS last_sale,
      (${TODAY} - ls.last_day)::int AS days_since_sale,
      COALESCE(ls.qty_12m, 0)::float8 AS sold_qty_12m
    FROM products p
    LEFT JOIN last_sale ls ON ls.product_id = p.id
    WHERE ${Prisma.join(filters, ' AND ')}
      AND (ls.last_day IS NULL OR ls.last_day < ${TODAY} - ${days}::int)
    ORDER BY (p.stock * COALESCE(p.purchase_price, p.sale_price, 0)) DESC NULLS LAST
    LIMIT ${limit}`);

  const buyers = new Map<string, unknown[]>();
  if (buyersPer > 0 && products.length) {
    const rows = await prisma.$queryRaw<{
      product_id: string; client_id: string; client: string; phone: string | null; manager: string;
      purchases: number; qty_total: number; last_bought: string;
    }[]>(Prisma.sql`
      WITH lines AS (${SALES_LINES}),
      agg AS (
        SELECT product_id, client_id, COUNT(DISTINCT day)::int AS purchases, SUM(qty)::float8 AS qty_total, MAX(day) AS last_day,
          ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY SUM(qty) DESC) AS rn
        FROM lines WHERE product_id = ANY(${products.map((p) => p.product_id)})
        GROUP BY product_id, client_id
      )
      SELECT a.product_id, c.id AS client_id, c.company_name AS client, c.phone, u.full_name AS manager,
        a.purchases, a.qty_total, to_char(a.last_day, 'YYYY-MM-DD') AS last_bought
      FROM agg a JOIN clients c ON c.id = a.client_id JOIN users u ON u.id = c.manager_id
      WHERE a.rn <= ${buyersPer} AND ${ACTIVE_CLIENT}
      ORDER BY a.product_id, a.rn`);
    for (const r of rows) {
      const { product_id: pid, ...rest } = r;
      buyers.set(pid, [...(buyers.get(pid) ?? []), rest]);
    }
  }

  return {
    rules: { days_without_sale: days, note: 'frozen_by_purchase — остаток по закупочной цене; last_sale=null — ни одной продажи в истории.' },
    products: products.map((p) => ({ ...p, past_buyers: buyers.get(p.product_id) ?? [] })),
  };
}

// ─── Менеджеры ──────────────────────────────────────────────────────────────

/** Кому можно ставить задачи: активные сотрудники, которые ведут клиентов или продавали за полгода. */
export async function listManagers() {
  const rows = await prisma.$queryRaw<{
    id: string; name: string; role: string; clients: number; deals_90d: number; revenue_90d: number;
  }[]>(Prisma.sql`
    WITH rev AS (
      SELECT d.manager_id, COUNT(DISTINCT d.id)::int AS deals, SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::float8 AS revenue
      FROM deal_items di JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= NOW() - INTERVAL '90 days'
      GROUP BY d.manager_id
    ),
    cl AS (
      SELECT c.manager_id, COUNT(*)::int AS clients FROM clients c WHERE ${ACTIVE_CLIENT} GROUP BY c.manager_id
    ),
    recent AS (
      SELECT DISTINCT d.manager_id FROM deals d WHERE d.created_at >= NOW() - INTERVAL '180 days'
    )
    SELECT u.id, u.full_name AS name, u.role::text AS role,
      COALESCE(cl.clients, 0) AS clients, COALESCE(rev.deals, 0) AS deals_90d, COALESCE(rev.revenue, 0)::float8 AS revenue_90d
    FROM users u
    LEFT JOIN cl ON cl.manager_id = u.id
    LEFT JOIN rev ON rev.manager_id = u.id
    WHERE u.is_active = true
      AND (u.role = 'MANAGER' OR u.id IN (SELECT manager_id FROM recent) OR COALESCE(cl.clients, 0) > 0)
    ORDER BY revenue_90d DESC, clients DESC`);
  return { managers: rows };
}
