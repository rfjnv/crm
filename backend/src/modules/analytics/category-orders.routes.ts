import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_ANALYTICS_TZ,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_ANALYTICS_LINE_REVENUE_DI,
} from '../../lib/analytics';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { responseCache } from '../../lib/responseCache';
import { INTERNAL_CATEGORY, NO_CATEGORY } from './category-analysis.service';
import {
  addMonths, arrivalStarts, monthRange, rateEvent, stockByMonth, trend3,
  type MonthRow, type RestockEvent,
} from './category-orders.service';

/**
 * Заказы и продажи по категориям: помесячно выручка, сделки, приход на склад,
 * заказы поставщикам и остаток. Для категории — разбор каждого прихода/заказа:
 * падали ли продажи до него и вернулись ли после.
 */
const router = Router();
router.use(authenticate);
router.use(responseCache(2 * 60_000));

const SQL_SALE_MONTH = Prisma.sql`to_char(DATE((${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}), 'YYYY-MM')`;
const SQL_SALE_DAY = Prisma.sql`DATE((${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})`;
const SQL_MOVE_DAY = Prisma.sql`DATE((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})`;
const SQL_CATEGORY = Prisma.sql`COALESCE(NULLIF(TRIM(p.category), ''), ${NO_CATEGORY})`;

type Scope = 'ext' | 'own' | 'all';

function currentMonthTashkent(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()).slice(0, 7);
}

function scopeSql(scope: Scope): Prisma.Sql {
  if (scope === 'own') return Prisma.sql`c.relation = 'AFFILIATE'`;
  if (scope === 'ext') return Prisma.sql`c.relation IS DISTINCT FROM 'AFFILIATE'`;
  return Prisma.sql`TRUE`;
}

const emptyRow = (month: string): MonthRow => ({ month, rev: 0, qty: 0, deals: 0, clients: 0, inQty: 0, orderedQty: 0, stock: null });

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query;
    const monthsBack = Math.min(36, Math.max(12, parseInt(String(q.months ?? '24'), 10) || 24));
    const scope: Scope = q.scope === 'own' || q.scope === 'all' ? q.scope : 'ext';
    const category = typeof q.category === 'string' && q.category.trim() ? q.category.trim() : null;

    const current = currentMonthTashkent();
    const from = addMonths(current, -(monthsBack - 1));
    // Ещё полгода назад — чтобы у ранних приходов была «обычная жизнь» для сравнения
    const dataFrom = addMonths(from, -6);
    const allMonths = monthRange(dataFrom, current);
    const visibleMonths = monthRange(from, current);
    const dataFromDay = `${dataFrom}-01`;

    const [products, salesByProduct, dealsByCat, totalsRows, arrivals, ordered, snaps, importOrders] = await Promise.all([
      prisma.$queryRaw<{ id: string; name: string; unit: string; category: string; stock: number }[]>(Prisma.sql`
        SELECT p.id, p.name, p.unit, ${SQL_CATEGORY} AS category, p.stock::float8 AS stock FROM products p
      `),
      prisma.$queryRaw<{ product_id: string; month: string; rev: number; qty: number }[]>(Prisma.sql`
        SELECT di.product_id, ${SQL_SALE_MONTH} AS month,
               SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::float8 AS rev,
               SUM(COALESCE(di.requested_qty, 0))::float8 AS qty
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN clients c ON c.id = d.client_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER} AND ${scopeSql(scope)}
          AND ${SQL_SALE_DAY} >= ${dataFromDay}::date
        GROUP BY 1, 2
      `),
      // Сделки и клиенты — DISTINCT внутри категории, поэтому отдельно от суммы по товарам
      prisma.$queryRaw<{ category: string; month: string; deals: number; clients: number }[]>(Prisma.sql`
        SELECT ${SQL_CATEGORY} AS category, ${SQL_SALE_MONTH} AS month,
               COUNT(DISTINCT d.id)::int AS deals, COUNT(DISTINCT d.client_id)::int AS clients
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN clients c ON c.id = d.client_id
        JOIN products p ON p.id = di.product_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER} AND ${scopeSql(scope)}
          AND ${SQL_SALE_DAY} >= ${dataFromDay}::date
        GROUP BY 1, 2
      `),
      prisma.$queryRaw<{ month: string; deals: number; clients: number }[]>(Prisma.sql`
        SELECT ${SQL_SALE_MONTH} AS month,
               COUNT(DISTINCT d.id)::int AS deals, COUNT(DISTINCT d.client_id)::int AS clients
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN clients c ON c.id = d.client_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER} AND ${scopeSql(scope)}
          AND ${SQL_SALE_DAY} >= ${dataFromDay}::date
        GROUP BY 1
      `),
      // Приход на склад: IN без сделки (возвраты) и без склада клиента (чужой товар)
      prisma.$queryRaw<{ product_id: string; month: string; day: string; qty: number }[]>(Prisma.sql`
        SELECT m.product_id, to_char(${SQL_MOVE_DAY}, 'YYYY-MM') AS month, MIN(${SQL_MOVE_DAY})::text AS day,
               SUM(m.quantity)::float8 AS qty
        FROM inventory_movements m
        WHERE m.type = 'IN' AND m.deal_id IS NULL AND m.client_stock_event_id IS NULL
          AND ${SQL_MOVE_DAY} >= ${dataFromDay}::date
        GROUP BY 1, 2
      `),
      prisma.$queryRaw<{ product_id: string; month: string; qty: number }[]>(Prisma.sql`
        SELECT i.product_id, to_char(o.order_date, 'YYYY-MM') AS month, SUM(i.qty)::float8 AS qty
        FROM import_order_items i JOIN import_orders o ON o.id = i.import_order_id
        WHERE o.status NOT IN ('DRAFT', 'CANCELED') AND o.order_date >= ${dataFromDay}::date
        GROUP BY 1, 2
      `),
      // Последний снимок остатка товара в каждом месяце + самый первый «до»
      prisma.$queryRaw<{ product_id: string; month: string; stock_after: number; first_before: number | null }[]>(Prisma.sql`
        SELECT DISTINCT ON (m.product_id, to_char(${SQL_MOVE_DAY}, 'YYYY-MM'))
               m.product_id, to_char(${SQL_MOVE_DAY}, 'YYYY-MM') AS month, m.stock_after::float8 AS stock_after,
               (SELECT f.stock_before::float8 FROM inventory_movements f
                 WHERE f.product_id = m.product_id AND f.stock_before IS NOT NULL
                 ORDER BY f.created_at ASC LIMIT 1) AS first_before
        FROM inventory_movements m
        WHERE m.stock_after IS NOT NULL
        ORDER BY m.product_id, to_char(${SQL_MOVE_DAY}, 'YYYY-MM'), m.created_at DESC
      `),
      category
        ? prisma.$queryRaw<{ id: string; number: string; status: string; order_date: string; eta: string | null; product_id: string; qty: number }[]>(Prisma.sql`
            SELECT o.id, o.number, o.status::text AS status, o.order_date::date::text AS order_date, o.eta::date::text AS eta,
                   i.product_id, SUM(i.qty)::float8 AS qty
            FROM import_orders o JOIN import_order_items i ON i.import_order_id = o.id
            WHERE o.status NOT IN ('DRAFT', 'CANCELED') AND o.order_date >= ${dataFromDay}::date
            GROUP BY 1, 2, 3, 4, 5, 6
          `)
        : Promise.resolve([]),
    ]);

    const catOf = new Map(products.map((p) => [p.id, p.category]));
    const visibleProducts = scope === 'ext' ? products.filter((p) => p.category !== INTERNAL_CATEGORY) : products;
    const catNames = [...new Set(visibleProducts.map((p) => p.category))];

    // ── Ряды по категориям ──
    const series = new Map<string, Map<string, MonthRow>>();
    const rowOf = (cat: string, month: string): MonthRow | null => {
      if (month < dataFrom || month > current) return null;
      let s = series.get(cat);
      if (!s) {
        s = new Map(allMonths.map((m) => [m, emptyRow(m)]));
        series.set(cat, s);
      }
      return s.get(month) ?? null;
    };
    for (const c of catNames) rowOf(c, current);

    for (const r of salesByProduct) {
      const row = rowOf(catOf.get(r.product_id) ?? NO_CATEGORY, r.month);
      if (row) { row.rev += Number(r.rev) || 0; row.qty += Number(r.qty) || 0; }
    }
    for (const r of dealsByCat) {
      const row = rowOf(r.category, r.month);
      if (row) { row.deals = r.deals; row.clients = r.clients; }
    }
    for (const r of arrivals) {
      const row = rowOf(catOf.get(r.product_id) ?? NO_CATEGORY, r.month);
      if (row) row.inQty += Number(r.qty) || 0;
    }
    for (const r of ordered) {
      const row = rowOf(catOf.get(r.product_id) ?? NO_CATEGORY, r.month);
      if (row) row.orderedQty += Number(r.qty) || 0;
    }

    // Остаток по товару на конец месяца → сумма по категории
    const snapsBy = new Map<string, { month: string; stockAfter: number; firstBefore: number | null }[]>();
    for (const s of snaps) {
      const list = snapsBy.get(s.product_id) ?? [];
      list.push({ month: s.month, stockAfter: Number(s.stock_after) || 0, firstBefore: s.first_before == null ? null : Number(s.first_before) });
      snapsBy.set(s.product_id, list);
    }
    const productStock = new Map<string, (number | null)[]>();
    for (const p of products) {
      const st = stockByMonth(allMonths, snapsBy.get(p.id) ?? [], Number(p.stock) || 0, current);
      productStock.set(p.id, st);
      const s = series.get(p.category);
      if (!s) continue;
      allMonths.forEach((m, i) => {
        const row = s.get(m);
        const v = st[i];
        if (row && v != null) row.stock = (row.stock ?? 0) + v;
      });
    }

    const unitsOf = (cat: string) => [...new Set(products.filter((p) => p.category === cat).map((p) => p.unit))];

    // ── Сводка по категориям ──
    const categories = catNames.map((name) => {
      const full = [...(series.get(name)?.values() ?? [])];
      const visible = full.filter((r) => r.month >= from);
      const t = trend3(full, current);
      const events = arrivalStarts(full)
        .map((r) => rateEvent(full, { kind: 'arrival', month: r.month, date: `${r.month}-01`, qty: r.inQty }, current))
        .filter((e): e is RestockEvent => !!e && e.month >= from);
      const lastEvent = events[events.length - 1] ?? null;
      const units = unitsOf(name);
      return {
        name,
        unit: units.length === 1 ? units[0] : null,
        rev: visible.reduce((s, r) => s + r.rev, 0),
        deals: visible.reduce((s, r) => s + r.deals, 0),
        inQty: visible.reduce((s, r) => s + r.inQty, 0),
        orderedQty: visible.reduce((s, r) => s + r.orderedQty, 0),
        stock: full[full.length - 1]?.stock ?? null,
        monthly: visible.map((r) => r.rev),
        last3: t.last3,
        prev3: t.prev3,
        trend: t.change,
        restocks: events.length,
        dipsBeforeRestock: events.filter((e) => e.dipped).length,
        lastRestock: lastEvent,
      };
    }).filter((c) => c.rev > 0 || c.inQty > 0 || c.orderedQty > 0)
      .sort((a, b) => b.rev - a.rev);

    // ── Итог по всем категориям ──
    const totalsBy = new Map(totalsRows.map((r) => [r.month, r]));
    const visibleCats = new Set(categories.map((c) => c.name));
    const totals = visibleMonths.map((m) => {
      let rev = 0, inQtyCats = 0, orderedCats = 0;
      for (const c of visibleCats) {
        const r = series.get(c)?.get(m);
        if (!r) continue;
        rev += r.rev;
        if (r.inQty > 0) inQtyCats++;
        if (r.orderedQty > 0) orderedCats++;
      }
      const t = totalsBy.get(m);
      return { month: m, rev, deals: t?.deals ?? 0, clients: t?.clients ?? 0, arrivalCategories: inQtyCats, orderCategories: orderedCats };
    });

    // ── Разбор одной категории ──
    let detail: unknown = null;
    if (category && series.has(category)) {
      const full = [...series.get(category)!.values()];
      const inCat = new Set(products.filter((p) => p.category === category).map((p) => p.id));
      const arrivalEvents = arrivalStarts(full).map((r) => {
        const firstDay = arrivals.filter((a) => a.month === r.month && inCat.has(a.product_id)).map((a) => a.day).sort()[0];
        return rateEvent(full, { kind: 'arrival', month: r.month, date: firstDay ?? `${r.month}-01`, qty: r.inQty }, current);
      });
      const orderMap = new Map<string, { number: string; status: string; date: string; eta: string | null; qty: number }>();
      for (const o of importOrders) {
        if (!inCat.has(o.product_id)) continue;
        const cur = orderMap.get(o.id) ?? { number: o.number, status: o.status, date: o.order_date, eta: o.eta, qty: 0 };
        cur.qty += Number(o.qty) || 0;
        orderMap.set(o.id, cur);
      }
      const importEvents = [...orderMap.values()].map((o) =>
        rateEvent(full, { kind: 'import', month: o.date.slice(0, 7), date: o.date, qty: o.qty, number: o.number, status: o.status, eta: o.eta }, current));
      const events = [...arrivalEvents, ...importEvents]
        .filter((e): e is RestockEvent => !!e && e.month >= from)
        .sort((a, b) => b.date.localeCompare(a.date));

      // Товары категории: выручка по месяцам и остаток
      const prodRows = products.filter((p) => inCat.has(p.id)).map((p) => {
        const byMonth = new Map<string, { rev: number; qty: number }>();
        for (const s of salesByProduct) if (s.product_id === p.id) byMonth.set(s.month, { rev: Number(s.rev) || 0, qty: Number(s.qty) || 0 });
        const inBy = new Map<string, number>();
        for (const a of arrivals) if (a.product_id === p.id) inBy.set(a.month, (inBy.get(a.month) ?? 0) + (Number(a.qty) || 0));
        const st = productStock.get(p.id) ?? [];
        const idx = (m: string) => allMonths.indexOf(m);
        const pSeries: MonthRow[] = allMonths.map((m) => ({
          ...emptyRow(m), rev: byMonth.get(m)?.rev ?? 0, qty: byMonth.get(m)?.qty ?? 0, inQty: inBy.get(m) ?? 0, stock: st[idx(m)] ?? null,
        }));
        const t = trend3(pSeries, current);
        return {
          id: p.id,
          name: p.name,
          unit: p.unit,
          stock: Number(p.stock) || 0,
          rev: pSeries.filter((r) => r.month >= from).reduce((s, r) => s + r.rev, 0),
          last3: t.last3,
          prev3: t.prev3,
          trend: t.change,
          months: pSeries.filter((r) => r.month >= from).map((r) => ({ month: r.month, rev: r.rev, qty: r.qty, inQty: r.inQty, stock: r.stock })),
        };
      }).filter((p) => p.rev > 0 || p.months.some((m) => m.inQty > 0))
        .sort((a, b) => b.rev - a.rev);

      const units = unitsOf(category);
      detail = {
        name: category,
        unit: units.length === 1 ? units[0] : null,
        months: full.filter((r) => r.month >= from),
        events,
        products: prodRows,
      };
    }

    res.json({ from, to: current, current, scope, months: visibleMonths, totals, categories, detail });
  }),
);

export { router as categoryOrdersRoutes };
