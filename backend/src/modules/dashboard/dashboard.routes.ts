import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
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

    const productsOfDayInRange = (rangeStart: Date, rangeEndExclusive: Date) =>
      dealScope.managerId
        ? prisma.$queryRaw<{ product_id: string; product_name: string; product_sku: string | null; product_unit: string | null; qty: string; revenue: string }[]>(
            Prisma.sql`SELECT di.product_id,
                              p.name AS product_name,
                              p.sku AS product_sku,
                              p.unit AS product_unit,
                              COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty,
                              COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text AS revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             JOIN products p ON p.id = di.product_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${rangeStart}
               AND COALESCE(di.deal_date, d.created_at) < ${rangeEndExclusive}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY di.product_id, p.name, p.sku, p.unit
             ORDER BY SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)) DESC, SUM(COALESCE(di.requested_qty, 0)) DESC`
          )
        : prisma.$queryRaw<{ product_id: string; product_name: string; product_sku: string | null; product_unit: string | null; qty: string; revenue: string }[]>(
            Prisma.sql`SELECT di.product_id,
                              p.name AS product_name,
                              p.sku AS product_sku,
                              p.unit AS product_unit,
                              COALESCE(SUM(COALESCE(di.requested_qty, 0)), 0)::text AS qty,
                              COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text AS revenue
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             JOIN products p ON p.id = di.product_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${rangeStart}
               AND COALESCE(di.deal_date, d.created_at) < ${rangeEndExclusive}
             GROUP BY di.product_id, p.name, p.sku, p.unit
             ORDER BY SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)) DESC, SUM(COALESCE(di.requested_qty, 0)) DESC`
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
      productsOfDayTodayRaw,
      productsOfDayYesterdayRaw,
    ] = await Promise.all([
      // 1. Revenue today (Excel-style: sum line_total from column I by deal date)
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${startOfToday}
               AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}
               AND d.manager_id = ${dealScope.managerId}`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${startOfToday}
               AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}`
          ),

      // 2. Revenue yesterday (for delta)
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
               AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}
               AND d.manager_id = ${dealScope.managerId}`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
               AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}`
          ),

      // 3. Revenue this month
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${startOfMonth}
               AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}
               AND d.manager_id = ${dealScope.managerId}`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${startOfMonth}
               AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}`
          ),

      // 4. Active deals count
      prisma.deal.count({
        where: {
          ...dealScope,
          status: { in: ['NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED', 'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT', 'SHIPMENT_ON_HOLD'] },
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

      // 8. Closed deals today
      prisma.deal.count({
        where: {
          ...dealScope,
          status: 'CLOSED',
          isArchived: false,
          updatedAt: { gte: startOfToday, lt: startOfTomorrow },
        },
      }),

      // 9. Closed deals yesterday
      prisma.deal.count({
        where: {
          ...dealScope,
          status: 'CLOSED',
          isArchived: false,
          updatedAt: { gte: startOfYesterday, lt: startOfToday },
        },
      }),

      // 10. Revenue last 30 days
      dealScope.managerId
        ? prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent') as day,
                              SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0))::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${thirtyDaysAgo}
               AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')
             ORDER BY day ASC`
          )
        : prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent') as day,
                              SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0))::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${thirtyDaysAgo}
               AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}
             GROUP BY DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')
             ORDER BY day ASC`
          ),

      // 11. Deals by status counts
      prisma.deal.groupBy({
        by: ['status'],
        where: { ...dealScope, isArchived: false },
        _count: true,
      }),
      productsOfDayInRange(startOfToday, startOfTomorrow),
      productsOfDayInRange(startOfYesterday, startOfToday),
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

    const productsOfDayToday = mapProductsOfDay(productsOfDayTodayRaw);
    const productsOfDayYesterday = mapProductsOfDay(productsOfDayYesterdayRaw);

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
      manager_id: string;
      manager_name: string;
      product_name: string;
    }[]>(
      Prisma.sql`SELECT di.id,
                        COALESCE(di.line_total, di.requested_qty * di.price, 0)::text as line_total,
                        COALESCE(di.deal_date, d.created_at) as deal_date,
                        d.id as deal_id, d.title as deal_title,
                        c.id as client_id, c.company_name,
                        u.id as manager_id, u.full_name as manager_name,
                        p.name as product_name
       FROM deal_items di
       JOIN deals d ON d.id = di.deal_id
       JOIN clients c ON c.id = d.client_id
       JOIN users u ON u.id = d.manager_id
       JOIN products p ON p.id = di.product_id
       WHERE d.status NOT IN ('CANCELED', 'REJECTED')
         AND d.is_archived = false
         AND COALESCE(di.deal_date, d.created_at) >= ${startOfToday}
         AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}
       ORDER BY COALESCE(di.deal_date, d.created_at) DESC`
    );

    const items = rows.map((r) => ({
      id: r.id,
      amount: r.line_total,
      paidAt: r.deal_date,
      method: null,
      deal: { id: r.deal_id, title: r.deal_title },
      client: { id: r.client_id, companyName: r.company_name },
      creator: { id: r.manager_id, fullName: r.manager_name },
      productName: r.product_name,
    }));

    const total = items.reduce((sum, i) => sum + Number(i.amount), 0);

    res.json({ payments: items, total });
  }),
);

export { router as dashboardRoutes };
