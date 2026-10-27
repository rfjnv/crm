import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_ANALYTICS_LINE_REVENUE_DI,
} from '../../lib/analytics';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';

import { responseCache } from '../../lib/responseCache';


/** День выручки по Ташкенту → 'YYYY-MM-DD'. */
function dayKey(day: Date | string): string {
  return day instanceof Date ? day.toISOString().slice(0, 10) : String(day).slice(0, 10);
}

/**
 * Данные блока «Цели»: выручка с начала года, по дням текущего месяца и по месяцам года.
 * `month` — номер месяца с нуля, как у Date.
 */
function buildGoals(rows: { day: Date | string; total: string }[], year: number, month: number) {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const days: { day: string; total: number }[] = [];
  let revenueYear = 0;
  for (const r of rows) {
    const key = dayKey(r.day);
    const total = Number(r.total) || 0;
    revenueYear += total;
    const m = Number(key.slice(5, 7));
    if (m >= 1 && m <= 12) months[m - 1].total += total;
    if (key.startsWith(monthPrefix)) days.push({ day: key, total });
  }
  return { year, month: month + 1, revenueYear, days, months };
}

const router = Router();

router.use(authenticate);
// Дашборд опрашивается раз в минуту у каждого; любая запись через API сбрасывает кеш
router.use(responseCache(60_000));

router.get(
  '/analytics',
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };
    const dealScope = ownerScope(user);

    const TASHKENT_OFFSET = 5 * 60 * 60 * 1000; // UTC+5
    const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
    const y = nowTashkent.getUTCFullYear();
    const mo = nowTashkent.getUTCMonth();
    const dy = nowTashkent.getUTCDate();

    const startOfToday = new Date(Date.UTC(y, mo, dy) - TASHKENT_OFFSET);
    const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
    const startOfMonth = new Date(Date.UTC(y, mo, 1) - TASHKENT_OFFSET);
    const startOfYear = new Date(Date.UTC(y, 0, 1) - TASHKENT_OFFSET);
    const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 86400000);

    const period = (req.query.period as string) || 'day';
    const isAdminRole = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

    let periodStart: Date;
    let periodEnd: Date;
    let prevPeriodStart: Date;
    let prevPeriodEnd: Date;
    let chartDays: number;

    switch (period) {
      case 'week': {
        const dayOfWeek = nowTashkent.getUTCDay();
        const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        periodStart = new Date(startOfToday.getTime() - mondayOffset * 86400000);
        periodEnd = startOfTomorrow;
        const weekLen = periodEnd.getTime() - periodStart.getTime();
        prevPeriodStart = new Date(periodStart.getTime() - weekLen);
        prevPeriodEnd = periodStart;
        chartDays = 7;
        break;
      }
      case 'month': {
        periodStart = startOfMonth;
        periodEnd = startOfTomorrow;
        const monthLen = periodEnd.getTime() - periodStart.getTime();
        prevPeriodStart = new Date(periodStart.getTime() - monthLen);
        prevPeriodEnd = periodStart;
        chartDays = 31;
        break;
      }
      case 'quarter': {
        const qMonth = Math.floor(mo / 3) * 3;
        periodStart = new Date(Date.UTC(y, qMonth, 1) - TASHKENT_OFFSET);
        periodEnd = startOfTomorrow;
        const quarterLen = periodEnd.getTime() - periodStart.getTime();
        prevPeriodStart = new Date(periodStart.getTime() - quarterLen);
        prevPeriodEnd = periodStart;
        chartDays = 92;
        break;
      }
      case 'custom': {
        if (!isAdminRole) {
          res.status(403).json({ error: 'Custom period is only available for admins' });
          return;
        }
        const fromStr = req.query.from as string;
        const toStr = req.query.to as string;
        if (!fromStr || !toStr) {
          res.status(400).json({ error: 'Custom period requires from and to parameters (YYYY-MM-DD)' });
          return;
        }
        const [fy, fm, fd] = fromStr.split('-').map(Number);
        const [ty, tm, td] = toStr.split('-').map(Number);
        periodStart = new Date(Date.UTC(fy, fm - 1, fd) - TASHKENT_OFFSET);
        periodEnd = new Date(Date.UTC(ty, tm - 1, td + 1) - TASHKENT_OFFSET);
        const customLen = periodEnd.getTime() - periodStart.getTime();
        prevPeriodStart = new Date(periodStart.getTime() - customLen);
        prevPeriodEnd = periodStart;
        chartDays = Math.ceil(customLen / 86400000);
        break;
      }
      default: {
        periodStart = startOfToday;
        periodEnd = startOfTomorrow;
        prevPeriodStart = startOfYesterday;
        prevPeriodEnd = startOfToday;
        chartDays = 30;
        break;
      }
    }

    const revenueDealTotalInRange = (rangeStart: Date, rangeEndExclusive: Date) =>
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
               AND d.manager_id = ${dealScope.managerId}`,
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}`,
          );

    const revenueByDayInRange = (rangeStart: Date, rangeEndExclusive: Date) =>
      dealScope.managerId
        ? prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT} as day,
                              SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT}
             ORDER BY day ASC`,
          )
        : prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT} as day,
                              SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
             GROUP BY ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT}
             ORDER BY day ASC`,
          );

    const productsOfDayInRange = (rangeStart: Date, rangeEndExclusive: Date) =>
      dealScope.managerId
        ? prisma.$queryRaw<{ product_id: string; product_name: string; product_sku: string | null; product_unit: string | null; qty: string; revenue: string }[]>(
            Prisma.sql`SELECT di.product_id,
                              p.name AS product_name,
                              p.sku AS product_sku,
                              p.unit AS product_unit,
                              COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty,
                              COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text AS revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             JOIN products p ON p.id = di.product_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY di.product_id, p.name, p.sku, p.unit
             ORDER BY SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}) DESC, SUM(COALESCE(di.requested_qty, 0)) DESC`,
          )
        : prisma.$queryRaw<{ product_id: string; product_name: string; product_sku: string | null; product_unit: string | null; qty: string; revenue: string }[]>(
            Prisma.sql`SELECT di.product_id,
                              p.name AS product_name,
                              p.sku AS product_sku,
                              p.unit AS product_unit,
                              COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty,
                              COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text AS revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             JOIN products p ON p.id = di.product_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
             GROUP BY di.product_id, p.name, p.sku, p.unit
             ORDER BY SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}) DESC, SUM(COALESCE(di.requested_qty, 0)) DESC`,
          );

    const chartStart = period === 'day'
      ? thirtyDaysAgo
      : periodStart;

    // Блок «Цели»: выручка по дням с начала года — из неё клетки дней месяца и месяцев года
    // Сбой здесь не должен ронять весь дашборд (и висеть необработанным отказом) — цели просто пустые
    const goalsDaysPromise = revenueByDayInRange(startOfYear, startOfTomorrow)
      .catch(() => [] as { day: Date; total: string }[]);

    // Блок «Выручка за 30 дней»: тот же отрезок прямо перед графиком — для «+N% к прошлым»
    const chartLenMs = periodEnd.getTime() - chartStart.getTime();
    const chartPrevPromise = revenueDealTotalInRange(new Date(chartStart.getTime() - chartLenMs), chartStart)
      .catch(() => [] as { total: string }[]);

    // Закрытые сделки по дням — мини-график в KPI-карточке «Закрыто сделок» (тот же диапазон, что у выручки)
    const closedChartPromise = prisma.deal.findMany({
      where: {
        ...dealScope,
        status: 'CLOSED',
        isArchived: false,
        closedAt: { gte: chartStart, lt: periodEnd },
      },
      select: { closedAt: true },
    });

    const [
      revenuePeriodAgg,
      revenuePrevPeriodAgg,
      revenueMonthAgg,
      activeDealsCount,
      totalDebtSplitRaw,
      zeroStockProducts,
      lowStockProducts,
      closedDealsPeriod,
      closedDealsPrevPeriod,
      revenueChartRaw,
      dealsByStatusCounts,
      productsOfDayTodayRaw,
      productsOfDayYesterdayRaw,
    ] = await Promise.all([
      revenueDealTotalInRange(periodStart, periodEnd),

      revenueDealTotalInRange(prevPeriodStart, prevPeriodEnd),

      revenueDealTotalInRange(startOfMonth, startOfTomorrow),

      prisma.deal.count({
        where: {
          ...dealScope,
          status: { notIn: ['CLOSED', 'CANCELED', 'REJECTED'] },
          isArchived: false,
        },
      }),

      dealScope.managerId
        ? prisma.$queryRaw<{ net_debt: string; pp_balance: string }[]>(
            Prisma.sql`WITH latest_deals AS (
                          SELECT DISTINCT ON (d.client_id) d.id AS deal_id
                          FROM deals d
                          WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
                            AND d.manager_id = ${dealScope.managerId}
                            AND EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id AND di.closing_balance IS NOT NULL)
                          ORDER BY d.client_id, d.created_at DESC
                        )
                        SELECT
                          COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F')
                            THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS net_debt,
                          COALESCE(SUM(CASE WHEN di.source_op_type = 'PP'
                            THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS pp_balance
                       FROM deal_items di
                       JOIN latest_deals ld ON ld.deal_id = di.deal_id
                       WHERE di.closing_balance IS NOT NULL`
          )
        : prisma.$queryRaw<{ net_debt: string; pp_balance: string }[]>(
            Prisma.sql`WITH latest_deals AS (
                          SELECT DISTINCT ON (d.client_id) d.id AS deal_id
                          FROM deals d
                          WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
                            AND EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id AND di.closing_balance IS NOT NULL)
                          ORDER BY d.client_id, d.created_at DESC
                        )
                        SELECT
                          COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F')
                            THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS net_debt,
                          COALESCE(SUM(CASE WHEN di.source_op_type = 'PP'
                            THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS pp_balance
                       FROM deal_items di
                       JOIN latest_deals ld ON ld.deal_id = di.deal_id
                       WHERE di.closing_balance IS NOT NULL`
          ),

      prisma.product.findMany({
        where: { isActive: true, stock: { equals: 0 } },
        select: { id: true, name: true, sku: true, stock: true, minStock: true },
        orderBy: { name: 'asc' },
      }),

      prisma.$queryRaw<{ id: string; name: string; sku: string; stock: number; min_stock: number }[]>(
        Prisma.sql`SELECT id, name, sku, stock, min_stock
         FROM products
         WHERE is_active = true AND stock > 0 AND stock < min_stock
         ORDER BY stock ASC`
      ),

      prisma.deal.count({
        where: {
          ...dealScope,
          status: 'CLOSED',
          isArchived: false,
          closedAt: { gte: periodStart, lt: periodEnd },
        },
      }),

      prisma.deal.count({
        where: {
          ...dealScope,
          status: 'CLOSED',
          isArchived: false,
          closedAt: { gte: prevPeriodStart, lt: prevPeriodEnd },
        },
      }),

      revenueByDayInRange(chartStart, periodEnd),

      prisma.deal.groupBy({
        by: ['status'],
        where: { ...dealScope, isArchived: false },
        _count: true,
      }),
      productsOfDayInRange(periodStart, periodEnd),
      productsOfDayInRange(prevPeriodStart, prevPeriodEnd),
    ]);

    const mapProductsOfDay = (
      rows: { product_id: string; product_name: string; product_sku: string | null; product_unit: string | null; qty: string; revenue: string }[],
    ) =>
      rows.map((row) => ({
        product: {
          id: row.product_id,
          name: row.product_name,
          sku: row.product_sku,
          unit: row.product_unit,
        },
        qty: Number(row.qty),
        revenue: Number(row.revenue),
      }));

    /**
     * Блок «Продажи дня»: категория, остаток, средняя продажа в рабочий день за 30 дней
     * (по всей компании — склад общий) и клиенты товара за день (в границах доступа).
     */
    const enrichProductsOfDay = async (
      rows: ReturnType<typeof mapProductsOfDay>,
      rangeStart: Date,
      rangeEndExclusive: Date,
    ) => {
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.product.id);
      try {
        const [products, sales, buyers] = await Promise.all([
          prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, category: true, stock: true, rollStock: true } }),
          prisma.$queryRaw<{ product_id: string; qty: string }[]>(
            Prisma.sql`SELECT di.product_id, COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty
             FROM deal_items di JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND di.product_id IN (${Prisma.join(ids)})
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${thirtyDaysAgo}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${startOfTomorrow}
             GROUP BY di.product_id`,
          ),
          prisma.$queryRaw<{ product_id: string; client_name: string }[]>(
            Prisma.sql`SELECT DISTINCT di.product_id, c.company_name AS client_name
             FROM deal_items di JOIN deals d ON d.id = di.deal_id JOIN clients c ON c.id = d.client_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND di.product_id IN (${Prisma.join(ids)})
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
               ${dealScope.managerId ? Prisma.sql`AND d.manager_id = ${dealScope.managerId}` : Prisma.empty}`,
          ),
        ]);
        // Рабочие дни за 30 дней (воскресенье — выходной)
        let workDays = 0;
        for (let t = thirtyDaysAgo.getTime(); t < startOfTomorrow.getTime(); t += 86_400_000) {
          if (new Date(t + TASHKENT_OFFSET).getUTCDay() !== 0) workDays += 1;
        }
        const byId = new Map(products.map((p) => [p.id, p]));
        const qty30 = new Map(sales.map((r) => [r.product_id, Number(r.qty) || 0]));
        const clients = new Map<string, string[]>();
        for (const b of buyers) clients.set(b.product_id, [...(clients.get(b.product_id) ?? []), b.client_name]);
        return rows.map((r) => {
          const p = byId.get(r.product.id);
          return {
            ...r,
            product: { ...r.product, category: p?.category ?? null },
            stock: p ? Number(p.stock) : null,
            rollStock: p?.rollStock != null ? Number(p.rollStock) : null,
            avgDailyQty: workDays > 0 ? (qty30.get(r.product.id) ?? 0) / workDays : 0,
            clients: (clients.get(r.product.id) ?? []).sort((a, b) => a.localeCompare(b, 'ru')),
          };
        });
      } catch {
        return rows;
      }
    };

    const [productsOfDayToday, productsOfDayYesterday] = await Promise.all([
      enrichProductsOfDay(mapProductsOfDay(productsOfDayTodayRaw), periodStart, periodEnd),
      enrichProductsOfDay(mapProductsOfDay(productsOfDayYesterdayRaw), prevPeriodStart, prevPeriodEnd),
    ]);

    const lowStockMapped = lowStockProducts.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      stock: Number(p.stock),
      minStock: Number(p.min_stock),
    }));

    const debtSplit = totalDebtSplitRaw[0];
    const netDebt = Number(debtSplit?.net_debt ?? 0);
    const prepayments = Number(debtSplit?.pp_balance ?? 0);
    const grossDebt = netDebt + prepayments;

    const periodLabels: Record<string, string> = {
      day: 'Сегодня',
      week: 'Неделя',
      month: 'Месяц',
      quarter: 'Квартал',
      custom: 'Период',
    };

    const closedChartRows = await closedChartPromise;
    const chartPrevAgg = await chartPrevPromise;
    const closedByDay = new Map<string, number>();
    for (const d of closedChartRows) {
      if (!d.closedAt) continue;
      // День по Ташкенту (UTC+5), как у выручки по дням
      const day = new Date(d.closedAt.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
      closedByDay.set(day, (closedByDay.get(day) ?? 0) + 1);
    }

    res.json({
      period: {
        key: period,
        label: periodLabels[period] || period,
        from: periodStart.toISOString(),
        to: periodEnd.toISOString(),
        chartDays,
      },
      revenueToday: revenuePeriodAgg[0] ? Number(revenuePeriodAgg[0].total) : 0,
      revenueYesterday: revenuePrevPeriodAgg[0] ? Number(revenuePrevPeriodAgg[0].total) : 0,
      revenueMonth: revenueMonthAgg[0] ? Number(revenueMonthAgg[0].total) : 0,
      /** Выручка за такой же отрезок перед графиком и закрытые за время графика */
      chartPrevTotal: chartPrevAgg[0] ? Number(chartPrevAgg[0].total) : 0,
      closedInChart: closedChartRows.length,
      goals: buildGoals(await goalsDaysPromise, y, mo),
      activeDealsCount,
      totalDebt: grossDebt,
      closedDealsToday: closedDealsPeriod,
      closedDealsYesterday: closedDealsPrevPeriod,
      zeroStockCount: zeroStockProducts.length,
      zeroStockProducts: zeroStockProducts.map((p) => ({
        id: p.id, name: p.name, sku: p.sku,
        stock: Number(p.stock), minStock: Number(p.minStock),
      })),
      lowStockProducts: lowStockMapped,
      revenueLast30Days: revenueChartRaw.map((r) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        total: Number(r.total),
      })),
      closedDealsByDay: [...closedByDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, count]) => ({ day, count })),
      dealsByStatusCounts: dealsByStatusCounts.map((d) => ({
        status: d.status,
        count: d._count,
      })),
      productOfDay: {
        today: productsOfDayToday[0] ?? null,
        yesterday: productsOfDayYesterday[0] ?? null,
      },
      productOfDayList: {
        today: productsOfDayToday,
        yesterday: productsOfDayYesterday,
      },
    });
  }),
);

// ──── Revenue Today drilldown ────
// ?date=YYYY-MM-DD — другой день (по календарю Ташкента); без параметра — сегодня.
router.get(
  '/revenue-today',
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };
    const dealScope = ownerScope(user);

    const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
    const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
    const dateParam = typeof req.query.date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(req.query.date) : null;
    const y = dateParam ? Number(dateParam[1]) : nowTashkent.getUTCFullYear();
    const mo = dateParam ? Number(dateParam[2]) - 1 : nowTashkent.getUTCMonth();
    const dy = dateParam ? Number(dateParam[3]) : nowTashkent.getUTCDate();
    const startOfToday = new Date(Date.UTC(y, mo, dy) - TASHKENT_OFFSET);
    const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);

    const dealManagerClause = dealScope.managerId
      ? Prisma.sql`AND d.manager_id = ${dealScope.managerId}`
      : Prisma.sql`AND TRUE`;

    // Только строки сделок: выручка признаётся при закрытии сделки.
    const rows = await prisma.$queryRaw<{
      id: string;
      line_total: string;
      deal_date: Date;
      deal_id: string | null;
      deal_title: string;
      client_id: string;
      company_name: string;
      is_svip: boolean;
      manager_id: string;
      manager_name: string;
      product_name: string;
      unit: string;
      qty: string | null;
      is_receipt_punched: boolean;
    }[]>(
      Prisma.sql`
        SELECT di.id,
               ${SQL_ANALYTICS_LINE_REVENUE_DI}::text as line_total,
               ${SQL_EFFECTIVE_REVENUE_ITEM_TS} as deal_date,
               d.id as deal_id,
               d.title as deal_title,
               c.id as client_id,
               c.company_name,
               c.is_svip as is_svip,
               u.id as manager_id,
               u.full_name as manager_name,
               p.name as product_name,
               COALESCE(p.unit, 'шт') as unit,
               di.requested_qty::text as qty,
               d.is_receipt_punched
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN clients c ON c.id = d.client_id
        JOIN users u ON u.id = d.manager_id
        JOIN products p ON p.id = di.product_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${startOfToday}
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${startOfTomorrow}
          ${dealManagerClause}
        ORDER BY deal_date DESC`,
    );

    const items = rows.map((r) => ({
      id: r.id,
      amount: r.line_total,
      paidAt: r.deal_date,
      method: null,
      deal: { id: r.deal_id, title: r.deal_title, isReceiptPunched: r.is_receipt_punched },
      client: { id: r.client_id, companyName: r.company_name, isSvip: !!r.is_svip },
      creator: { id: r.manager_id, fullName: r.manager_name },
      productName: r.product_name,
      qty: r.qty !== null ? Number(r.qty) : null,
      unit: r.unit,
    }));

    const total = items.reduce((sum, i) => sum + Number(i.amount), 0);

    res.json({ payments: items, total });
  }),
);

export { router as dashboardRoutes };
