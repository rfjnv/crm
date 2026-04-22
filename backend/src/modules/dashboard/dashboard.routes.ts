import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_LINE_REVENUE_DI,
} from '../../lib/analytics';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';

const router = Router();

router.use(authenticate);

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

    // Midnight Tashkent in UTC
    const startOfToday = new Date(Date.UTC(y, mo, dy) - TASHKENT_OFFSET);
    const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
    const startOfMonth = new Date(Date.UTC(y, mo, 1) - TASHKENT_OFFSET);
    const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 86400000);

    const revenueTotalInRange = (rangeStart: Date, rangeEndExclusive: Date) =>
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
               AND d.manager_id = ${dealScope.managerId}`,
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as total
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
                              SUM(${SQL_LINE_REVENUE_DI})::text as total
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
                              SUM(${SQL_LINE_REVENUE_DI})::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
             GROUP BY ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT}
             ORDER BY day ASC`,
          );

    const topProductInRange = (rangeStart: Date, rangeEndExclusive: Date) =>
      dealScope.managerId
        ? prisma.$queryRaw<{ product_id: string; product_name: string; product_sku: string | null; qty: string; revenue: string }[]>(
            Prisma.sql`SELECT di.product_id,
                              p.name AS product_name,
                              p.sku AS product_sku,
                              COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty,
                              COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text AS revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             JOIN products p ON p.id = di.product_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY di.product_id, p.name, p.sku
             ORDER BY SUM(${SQL_LINE_REVENUE_DI}) DESC, SUM(COALESCE(di.requested_qty, 0)) DESC
             LIMIT 1`,
          )
        : prisma.$queryRaw<{ product_id: string; product_name: string; product_sku: string | null; qty: string; revenue: string }[]>(
            Prisma.sql`SELECT di.product_id,
                              p.name AS product_name,
                              p.sku AS product_sku,
                              COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty,
                              COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text AS revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             JOIN products p ON p.id = di.product_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
             GROUP BY di.product_id, p.name, p.sku
             ORDER BY SUM(${SQL_LINE_REVENUE_DI}) DESC, SUM(COALESCE(di.requested_qty, 0)) DESC
             LIMIT 1`,
          );

    const topProductClientsInRange = (rangeStart: Date, rangeEndExclusive: Date, productId: string) =>
      dealScope.managerId
        ? prisma.$queryRaw<{ client_id: string; company_name: string; qty: string; revenue: string }[]>(
            Prisma.sql`SELECT c.id AS client_id,
                              c.company_name,
                              COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty,
                              COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text AS revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             JOIN clients c ON c.id = d.client_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND di.product_id = ${productId}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY c.id, c.company_name
             ORDER BY SUM(${SQL_LINE_REVENUE_DI}) DESC, SUM(COALESCE(di.requested_qty, 0)) DESC
             LIMIT 20`,
          )
        : prisma.$queryRaw<{ client_id: string; company_name: string; qty: string; revenue: string }[]>(
            Prisma.sql`SELECT c.id AS client_id,
                              c.company_name,
                              COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty,
                              COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text AS revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             JOIN clients c ON c.id = d.client_id
             WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
               AND di.product_id = ${productId}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${rangeStart}
               AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${rangeEndExclusive}
             GROUP BY c.id, c.company_name
             ORDER BY SUM(${SQL_LINE_REVENUE_DI}) DESC, SUM(COALESCE(di.requested_qty, 0)) DESC
             LIMIT 20`,
          );

    const [
      revenueTodayAgg,
      revenueYesterdayAgg,
      revenueMonthAgg,
      activeDealsCount,
      totalDebtSplitRaw,
      zeroStockProducts,
      lowStockProducts,
      closedDealsToday,
      closedDealsYesterday,
      revenueLast30DaysRaw,
      dealsByStatusCounts,
      topProductTodayRaw,
      topProductYesterdayRaw,
    ] = await Promise.all([
      // 1. Revenue today (operational: line totals, active deals, effective item date)
      revenueTotalInRange(startOfToday, startOfTomorrow),

      // 2. Revenue yesterday (for delta)
      revenueTotalInRange(startOfYesterday, startOfToday),

      // 3. Revenue this month
      revenueTotalInRange(startOfMonth, startOfTomorrow),

      // 4. Active deals count (все не завершённые статусы, включая новый контур склада/доставки)
      prisma.deal.count({
        where: {
          ...dealScope,
          status: { notIn: ['CLOSED', 'CANCELED', 'REJECTED'] },
          isArchived: false,
        },
      }),

      // 5. Total debt (same as /finance/debts totals: gross = net debt + prepayments)
      // IMPORTANT: Only use the latest deal per client to avoid multi-month duplication.
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

      // 6. Zero stock products
      prisma.product.findMany({
        where: { isActive: true, stock: { equals: 0 } },
        select: { id: true, name: true, sku: true, stock: true, minStock: true },
        orderBy: { name: 'asc' },
      }),

      // 7. Low stock products (stock > 0 but < minStock)
      prisma.$queryRaw<{ id: string; name: string; sku: string; stock: number; min_stock: number }[]>(
        Prisma.sql`SELECT id, name, sku, stock, min_stock
         FROM products
         WHERE is_active = true AND stock > 0 AND stock < min_stock
         ORDER BY stock ASC`
      ),

      // 8. Closed deals today (по closedAt в календарный день Ташкент; updatedAt трогают платежи и миграции)
      prisma.deal.count({
        where: {
          ...dealScope,
          status: 'CLOSED',
          isArchived: false,
          closedAt: { gte: startOfToday, lt: startOfTomorrow },
        },
      }),

      // 9. Closed deals yesterday
      prisma.deal.count({
        where: {
          ...dealScope,
          status: 'CLOSED',
          isArchived: false,
          closedAt: { gte: startOfYesterday, lt: startOfToday },
        },
      }),

      // 10. Revenue last 30 days (by Tashkent calendar day)
      revenueByDayInRange(thirtyDaysAgo, startOfTomorrow),

      // 11. Deals by status counts
      prisma.deal.groupBy({
        by: ['status'],
        where: { ...dealScope, isArchived: false },
        _count: true,
      }),
      topProductInRange(startOfToday, startOfTomorrow),
      topProductInRange(startOfYesterday, startOfToday),
    ]);

    const mapTopProductPeriod = async (
      rangeStart: Date,
      rangeEndExclusive: Date,
      raw: { product_id: string; product_name: string; product_sku: string | null; qty: string; revenue: string }[],
    ) => {
      const top = raw[0];
      if (!top) return null;
      const clientsRaw = await topProductClientsInRange(rangeStart, rangeEndExclusive, top.product_id);
      return {
        product: {
          id: top.product_id,
          name: top.product_name,
          sku: top.product_sku,
        },
        qty: Number(top.qty),
        revenue: Number(top.revenue),
        clients: clientsRaw.map((c) => ({
          clientId: c.client_id,
          companyName: c.company_name,
          qty: Number(c.qty),
          revenue: Number(c.revenue),
        })),
      };
    };

    const [topProductToday, topProductYesterday] = await Promise.all([
      mapTopProductPeriod(startOfToday, startOfTomorrow, topProductTodayRaw),
      mapTopProductPeriod(startOfYesterday, startOfToday, topProductYesterdayRaw),
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

    res.json({
      revenueToday: revenueTodayAgg[0] ? Number(revenueTodayAgg[0].total) : 0,
      revenueYesterday: revenueYesterdayAgg[0] ? Number(revenueYesterdayAgg[0].total) : 0,
      revenueMonth: revenueMonthAgg[0] ? Number(revenueMonthAgg[0].total) : 0,
      activeDealsCount,
      totalDebt: grossDebt,
      closedDealsToday,
      closedDealsYesterday,
      zeroStockCount: zeroStockProducts.length,
      zeroStockProducts: zeroStockProducts.map((p) => ({
        id: p.id, name: p.name, sku: p.sku,
        stock: Number(p.stock), minStock: Number(p.minStock),
      })),
      lowStockProducts: lowStockMapped,
      revenueLast30Days: revenueLast30DaysRaw.map((r) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        total: Number(r.total),
      })),
      dealsByStatusCounts: dealsByStatusCounts.map((d) => ({
        status: d.status,
        count: d._count,
      })),
      productOfDay: {
        today: topProductToday,
        yesterday: topProductYesterday,
      },
    });
  }),
);

// ──── Revenue Today drilldown ────
router.get(
  '/revenue-today',
  asyncHandler(async (req: Request, res: Response) => {
    const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
    const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
    const y = nowTashkent.getUTCFullYear();
    const mo = nowTashkent.getUTCMonth();
    const dy = nowTashkent.getUTCDate();
    const startOfToday = new Date(Date.UTC(y, mo, dy) - TASHKENT_OFFSET);
    const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);

    // Show deal items matching today's revenue (aligned with dashboard card formula)
    const rows = await prisma.$queryRaw<{
      id: string;
      line_total: string;
      deal_date: Date;
      deal_id: string;
      deal_title: string;
      client_id: string;
      company_name: string;
      is_svip: boolean;
      manager_id: string;
      manager_name: string;
      product_name: string;
    }[]>(
      Prisma.sql`SELECT di.id,
                        ${SQL_LINE_REVENUE_DI}::text as line_total,
                        ${SQL_EFFECTIVE_REVENUE_ITEM_TS} as deal_date,
                        d.id as deal_id, d.title as deal_title,
                        c.id as client_id, c.company_name, c.is_svip as is_svip,
                        u.id as manager_id, u.full_name as manager_name,
                        p.name as product_name
       FROM deal_items di
       JOIN deals d ON d.id = di.deal_id
       JOIN clients c ON c.id = d.client_id
       JOIN users u ON u.id = d.manager_id
       JOIN products p ON p.id = di.product_id
       WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
         AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${startOfToday}
         AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${startOfTomorrow}
       ORDER BY ${SQL_EFFECTIVE_REVENUE_ITEM_TS} DESC`
    );

    const items = rows.map((r) => ({
      id: r.id,
      amount: r.line_total,
      paidAt: r.deal_date,
      method: null,
      deal: { id: r.deal_id, title: r.deal_title },
      client: { id: r.client_id, companyName: r.company_name, isSvip: !!r.is_svip },
      creator: { id: r.manager_id, fullName: r.manager_name },
      productName: r.product_name,
    }));

    const total = items.reduce((sum, i) => sum + Number(i.amount), 0);

    res.json({ payments: items, total });
  }),
);

export { router as dashboardRoutes };
