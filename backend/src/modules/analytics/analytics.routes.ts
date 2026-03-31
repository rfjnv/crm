import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';

const router = Router();

router.use(authenticate);

// Tashkent = UTC+5
const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;

function getPeriodRange(period: string): { start: Date; end: Date } {
  // Compute "now" in Tashkent timezone
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
  const y = nowTashkent.getUTCFullYear();
  const m = nowTashkent.getUTCMonth();
  const d = nowTashkent.getUTCDate();

  // Midnight Tashkent in UTC = Date.UTC(y,m,d) - offset
  const startOfTodayUtc = new Date(Date.UTC(y, m, d) - TASHKENT_OFFSET);
  const end = new Date(startOfTodayUtc.getTime() + 86400000); // tomorrow midnight Tashkent
  let start: Date;

  switch (period) {
    case 'week':
      start = new Date(end.getTime() - 7 * 86400000);
      break;
    case 'quarter':
      start = new Date(Date.UTC(y, m - 3, d) - TASHKENT_OFFSET);
      break;
    case 'year':
      start = new Date(Date.UTC(y - 1, m, d) - TASHKENT_OFFSET);
      break;
    case 'month':
    default:
      start = new Date(Date.UTC(y, m, 1) - TASHKENT_OFFSET);
      break;
  }

  return { start, end };
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };
    const dealScope = ownerScope(user);
    const period = (req.query.period as string) || 'month';
    const { start, end } = getPeriodRange(period);

    // ──── SALES ────
    const [
      salesRevenueRaw,
      salesAvgAgg,
      completedCount,
      totalDealsCount,
      canceledCount,
      revenueByDayRaw,
      dealsByStatus,
      topClientsRaw,
      topProductsRaw,
    ] = await Promise.all([
      // Total revenue in period (Excel-like logic: sum line_total by deal date)
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status IN ('SHIPPED', 'CLOSED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${start}
               AND COALESCE(di.deal_date, d.created_at) < ${end}
               AND d.manager_id = ${dealScope.managerId}`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status IN ('SHIPPED', 'CLOSED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${start}
               AND COALESCE(di.deal_date, d.created_at) < ${end}`
          ),
      // Avg deal amount in period (from deal items line_total)
      dealScope.managerId
        ? prisma.$queryRaw<{ avg_amount: string }[]>(
            Prisma.sql`SELECT COALESCE(AVG(di_rev.rev), 0)::text as avg_amount
             FROM deals d
             LEFT JOIN (SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0)) as rev FROM deal_items GROUP BY deal_id) di_rev ON di_rev.deal_id = d.id
             WHERE d.status IN ('SHIPPED', 'CLOSED') AND d.is_archived = false
               AND d.created_at >= ${start} AND d.created_at < ${end}
               AND d.manager_id = ${dealScope.managerId}`
          )
        : prisma.$queryRaw<{ avg_amount: string }[]>(
            Prisma.sql`SELECT COALESCE(AVG(di_rev.rev), 0)::text as avg_amount
             FROM deals d
             LEFT JOIN (SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0)) as rev FROM deal_items GROUP BY deal_id) di_rev ON di_rev.deal_id = d.id
             WHERE d.status IN ('SHIPPED', 'CLOSED') AND d.is_archived = false
               AND d.created_at >= ${start} AND d.created_at < ${end}`
          ),
      // COMPLETED + CLOSED count (for conversion)
      prisma.deal.count({
        where: { ...dealScope, status: { in: ['SHIPPED', 'CLOSED'] }, isArchived: false, createdAt: { gte: start, lt: end } },
      }),
      // Total deals created in period (all statuses)
      prisma.deal.count({
        where: { ...dealScope, isArchived: false, createdAt: { gte: start, lt: end } },
      }),
      // CANCELED count
      prisma.deal.count({
        where: { ...dealScope, status: 'CANCELED', isArchived: false, createdAt: { gte: start, lt: end } },
      }),
      // Revenue by day (group by Excel row date when available)
      dealScope.managerId
        ? prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent') as day,
                              SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0))::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status IN ('SHIPPED', 'CLOSED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${start}
               AND COALESCE(di.deal_date, d.created_at) < ${end}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')
             ORDER BY day ASC`
          )
        : prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent') as day,
                              SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0))::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status IN ('SHIPPED', 'CLOSED')
               AND d.is_archived = false
               AND COALESCE(di.deal_date, d.created_at) >= ${start}
               AND COALESCE(di.deal_date, d.created_at) < ${end}
             GROUP BY DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')
             ORDER BY day ASC`
          ),
      // Deals by status
      prisma.deal.groupBy({
        by: ['status'],
        where: { ...dealScope, isArchived: false, createdAt: { gte: start, lt: end } },
        _count: true,
      }),
      // Top 5 clients by revenue (from deal items line_total)
      dealScope.managerId
        ? prisma.$queryRaw<{ client_id: string; company_name: string; total_revenue: string }[]>(
            Prisma.sql`SELECT c.id as client_id, c.company_name, COALESCE(SUM(di_rev.rev), 0)::text as total_revenue
             FROM deals d
             JOIN clients c ON c.id = d.client_id
             LEFT JOIN (SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0)) as rev FROM deal_items GROUP BY deal_id) di_rev ON di_rev.deal_id = d.id
             WHERE d.status IN ('SHIPPED', 'CLOSED')
               AND d.is_archived = false
               AND d.created_at >= ${start} AND d.created_at < ${end}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY c.id, c.company_name
             ORDER BY SUM(di_rev.rev) DESC NULLS LAST
             LIMIT 5`
          )
        : prisma.$queryRaw<{ client_id: string; company_name: string; total_revenue: string }[]>(
            Prisma.sql`SELECT c.id as client_id, c.company_name, COALESCE(SUM(di_rev.rev), 0)::text as total_revenue
             FROM deals d
             JOIN clients c ON c.id = d.client_id
             LEFT JOIN (SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0)) as rev FROM deal_items GROUP BY deal_id) di_rev ON di_rev.deal_id = d.id
             WHERE d.status IN ('SHIPPED', 'CLOSED')
               AND d.is_archived = false
               AND d.created_at >= ${start} AND d.created_at < ${end}
             GROUP BY c.id, c.company_name
             ORDER BY SUM(di_rev.rev) DESC NULLS LAST
             LIMIT 5`
          ),
      // Top 5 products by quantity sold
      prisma.$queryRaw<{ product_id: string; name: string; total_quantity: string }[]>(
        Prisma.sql`SELECT p.id as product_id, p.name, SUM(m.quantity)::text as total_quantity
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.type = 'OUT'
           AND m.created_at >= ${start} AND m.created_at < ${end}
         GROUP BY p.id, p.name
         ORDER BY SUM(m.quantity) DESC
         LIMIT 5`
      ),
    ]);

    const revenueByDay = revenueByDayRaw.map((r) => {
      const d = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
      return { day: d, total: Number(r.total) };
    });

    const sales = {
      totalRevenue: salesRevenueRaw[0] ? Number(salesRevenueRaw[0].total) : 0,
      avgDealAmount: salesAvgAgg[0] ? Number(salesAvgAgg[0].avg_amount) : 0,
      conversionNewToCompleted: totalDealsCount > 0 ? completedCount / totalDealsCount : null,
      cancellationRate: totalDealsCount > 0 ? canceledCount / totalDealsCount : null,
      totalDeals: totalDealsCount,
      completedDeals: completedCount,
      canceledDeals: canceledCount,
      revenueByDay,
      dealsByStatus: dealsByStatus.map((d) => ({ status: d.status, count: d._count })),
      topClients: topClientsRaw.map((c) => ({
        clientId: c.client_id,
        companyName: c.company_name,
        totalRevenue: Number(c.total_revenue),
      })),
      topProducts: topProductsRaw.map((p) => ({
        productId: p.product_id,
        name: p.name,
        totalQuantity: Number(p.total_quantity),
      })),
    };

    // ──── FINANCE ────
    const [totalDebtRaw, overdueDeals, topDebtorsRaw, realTurnoverAgg, paperTurnoverAgg] = await Promise.all([
      prisma.deal.groupBy({
        by: ['clientId'],
        where: {
          ...dealScope,
          isArchived: false,
          status: { notIn: ['CANCELED', 'REJECTED'] },
        },
        _sum: {
          amount: true,
          paidAmount: true,
        }
      }),
      prisma.deal.findMany({
        where: {
          ...dealScope,
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          dueDate: { lt: new Date() },
          isArchived: false,
        },
        include: { client: { select: { id: true, companyName: true } } },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      dealScope.managerId
        ? prisma.$queryRaw<{ client_id: string; company_name: string; total_debt: string }[]>(
            Prisma.sql`SELECT c.id as client_id, c.company_name, SUM(d.amount - d.paid_amount)::text as total_debt
             FROM deals d
             JOIN clients c ON c.id = d.client_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY c.id, c.company_name
             HAVING SUM(d.amount - d.paid_amount) > 0
             ORDER BY SUM(d.amount - d.paid_amount) DESC
             LIMIT 10`
          )
        : prisma.$queryRaw<{ client_id: string; company_name: string; total_debt: string }[]>(
            Prisma.sql`SELECT c.id as client_id, c.company_name, SUM(d.amount - d.paid_amount)::text as total_debt
             FROM deals d
             JOIN clients c ON c.id = d.client_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
             GROUP BY c.id, c.company_name
             HAVING SUM(d.amount - d.paid_amount) > 0
             ORDER BY SUM(d.amount - d.paid_amount) DESC
             LIMIT 10`
          ),
      prisma.deal.aggregate({
        where: { ...dealScope, status: { in: ['SHIPPED', 'CLOSED'] }, isArchived: false, createdAt: { gte: start, lt: end } },
        _sum: { paidAmount: true },
      }),
      // Paper turnover (from deal items line_total)
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status IN ('SHIPPED', 'CLOSED') AND d.is_archived = false
               AND d.created_at >= ${start} AND d.created_at < ${end}
               AND d.manager_id = ${dealScope.managerId}`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status IN ('SHIPPED', 'CLOSED') AND d.is_archived = false
               AND d.created_at >= ${start} AND d.created_at < ${end}`
          ),
    ]);

    const totalDebtGrouped = totalDebtRaw as unknown as { clientId: string, _sum: { amount: Prisma.Decimal | null, paidAmount: Prisma.Decimal | null } }[];
    let grossDebt = 0;
    for (const row of totalDebtGrouped) {
      const netDebt = Number(row._sum?.amount ?? 0) - Number(row._sum?.paidAmount ?? 0);
      if (netDebt > 0) grossDebt += netDebt;
    }

    const finance = {
      totalDebt: grossDebt,
      overdueDebts: overdueDeals.map((d) => ({
        dealId: d.id,
        title: d.title,
        clientName: d.client.companyName,
        debt: Number(d.amount) - Number(d.paidAmount),
        dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
      })),
      topDebtors: topDebtorsRaw.map((d) => ({
        clientId: d.client_id,
        companyName: d.company_name,
        totalDebt: Number(d.total_debt),
      })),
      realTurnover: realTurnoverAgg._sum.paidAmount ? Number(realTurnoverAgg._sum.paidAmount) : 0,
      paperTurnover: paperTurnoverAgg[0] ? Number(paperTurnoverAgg[0].total) : 0,
    };

    // ──── WAREHOUSE ────
    const [belowMinStockRaw, deadStockRaw, topSellingRaw, frozenCapitalRaw] = await Promise.all([
      prisma.$queryRaw<{ id: string; name: string; sku: string; stock: number; min_stock: number }[]>(
        Prisma.sql`SELECT id, name, sku, stock, min_stock
         FROM products
         WHERE is_active = true AND stock < min_stock AND stock >= 0
         ORDER BY stock ASC`
      ),
      prisma.$queryRaw<{ id: string; name: string; sku: string; stock: number; last_out_date: Date | null }[]>(
        Prisma.sql`SELECT p.id, p.name, p.sku, p.stock,
                MAX(m.created_at) as last_out_date
         FROM products p
         LEFT JOIN inventory_movements m ON m.product_id = p.id AND m.type = 'OUT'
         WHERE p.is_active = true AND p.stock > 0
         GROUP BY p.id, p.name, p.sku, p.stock
         HAVING MAX(m.created_at) IS NULL OR MAX(m.created_at) < NOW() - INTERVAL '30 days'
         ORDER BY p.stock DESC`
      ),
      prisma.$queryRaw<{ product_id: string; name: string; total_sold: string }[]>(
        Prisma.sql`SELECT p.id as product_id, p.name, SUM(m.quantity)::text as total_sold
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.type = 'OUT'
         GROUP BY p.id, p.name
         ORDER BY SUM(m.quantity) DESC
         LIMIT 10`
      ),
      prisma.$queryRaw<{ value: string }[]>`
        SELECT COALESCE(SUM(stock * purchase_price), 0)::text as value
        FROM products
        WHERE is_active = true AND purchase_price IS NOT NULL
      `,
    ]);

    const warehouse = {
      belowMinStock: belowMinStockRaw.map((p) => ({
        id: p.id, name: p.name, sku: p.sku, stock: Number(p.stock), minStock: Number(p.min_stock),
      })),
      deadStock: deadStockRaw.map((p) => ({
        id: p.id, name: p.name, sku: p.sku, stock: Number(p.stock),
        lastOutDate: p.last_out_date ? p.last_out_date.toISOString().slice(0, 10) : null,
      })),
      topSelling: topSellingRaw.map((p) => ({
        productId: p.product_id, name: p.name, totalSold: Number(p.total_sold),
      })),
      frozenCapital: frozenCapitalRaw[0] ? Number(frozenCapitalRaw[0].value) : 0,
    };

    // ──── MANAGERS ────
    const [managerStatsRaw, managerAvgDaysRaw] = await Promise.all([
      prisma.$queryRaw<{
        manager_id: string; full_name: string;
        completed_count: string; total_revenue: string; avg_deal_amount: string;
        total_deals: string;
      }[]>(
        Prisma.sql`SELECT
           d.manager_id,
           u.full_name,
           COUNT(*) FILTER (WHERE d.status IN ('SHIPPED', 'CLOSED'))::text as completed_count,
           COALESCE(SUM(di_rev.rev) FILTER (WHERE d.status IN ('SHIPPED', 'CLOSED')), 0)::text as total_revenue,
           COALESCE(AVG(di_rev.rev) FILTER (WHERE d.status IN ('SHIPPED', 'CLOSED')), 0)::text as avg_deal_amount,
           COUNT(*)::text as total_deals
         FROM deals d
         JOIN users u ON u.id = d.manager_id
         LEFT JOIN (SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0)) as rev FROM deal_items GROUP BY deal_id) di_rev ON di_rev.deal_id = d.id
         WHERE d.is_archived = false
           AND d.created_at >= ${start} AND d.created_at < ${end}
         GROUP BY d.manager_id, u.full_name
         ORDER BY SUM(di_rev.rev) FILTER (WHERE d.status IN ('SHIPPED', 'CLOSED')) DESC NULLS LAST`
      ),
      prisma.$queryRaw<{ manager_id: string; avg_days: string }[]>(
        Prisma.sql`SELECT
           d.manager_id,
           AVG(EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) / 86400)::text as avg_days
         FROM deals d
         WHERE d.status IN ('SHIPPED', 'CLOSED') AND d.is_archived = false
           AND d.created_at >= ${start} AND d.created_at < ${end}
         GROUP BY d.manager_id`
      ),
    ]);

    const avgDaysMap = new Map(managerAvgDaysRaw.map((m) => [m.manager_id, Number(m.avg_days)]));

    const managers = {
      rows: managerStatsRaw.map((m) => ({
        managerId: m.manager_id,
        fullName: m.full_name,
        completedCount: Number(m.completed_count),
        totalRevenue: Number(m.total_revenue),
        avgDealAmount: Number(m.avg_deal_amount),
        conversionRate: Number(m.total_deals) > 0 ? Number(m.completed_count) / Number(m.total_deals) : 0,
        avgDealDays: avgDaysMap.get(m.manager_id) ?? 0,
      })),
    };

    // ──── PROFITABILITY ────
    const [revenueRaw, cogsRaw, totalExpensesRaw, expByCategoryRaw] = await Promise.all([
      prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
         FROM payments p
         WHERE p.paid_at >= ${start} AND p.paid_at < ${end}`
      ),
      prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(di.requested_qty * pr.purchase_price), 0)::text as total
         FROM deal_items di
         JOIN deals d ON d.id = di.deal_id
         JOIN products pr ON pr.id = di.product_id
         WHERE d.status IN ('SHIPPED', 'CLOSED')
           AND d.is_archived = false
           AND d.created_at >= ${start} AND d.created_at < ${end}
           AND di.requested_qty IS NOT NULL
           AND pr.purchase_price IS NOT NULL`
      ),
      prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(amount), 0)::text as total
         FROM expenses
         WHERE date >= ${start} AND date < ${end}
           AND status = 'APPROVED'`
      ),
      prisma.$queryRaw<{ category: string; total: string }[]>(
        Prisma.sql`SELECT category, SUM(amount)::text as total
         FROM expenses
         WHERE date >= ${start} AND date < ${end}
           AND status = 'APPROVED'
         GROUP BY category
         ORDER BY SUM(amount) DESC`
      ),
    ]);

    const profRevenue = Number(revenueRaw[0]?.total || 0);
    const profCogs = Number(cogsRaw[0]?.total || 0);
    const profExpenses = Number(totalExpensesRaw[0]?.total || 0);
    const grossProfit = profRevenue - profCogs;
    const netProfit = grossProfit - profExpenses;

    const profitability = {
      revenue: profRevenue,
      cogs: profCogs,
      grossProfit,
      expenses: profExpenses,
      netProfit,
      expensesByCategory: expByCategoryRaw.map((e) => ({
        category: e.category,
        total: Number(e.total),
      })),
    };

    res.json({ sales, finance, warehouse, managers, profitability });
  }),
);

export { router as analyticsRoutes };
