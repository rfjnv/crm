import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';

const router = Router();

router.use(authenticate);

function getPeriodRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let start: Date;

  switch (period) {
    case 'week':
      start = new Date(end);
      start.setDate(start.getDate() - 7);
      break;
    case 'quarter':
      start = new Date(end);
      start.setMonth(start.getMonth() - 3);
      break;
    case 'year':
      start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      break;
    case 'month':
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
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

    const managerWhere = dealScope.managerId
      ? `AND d.manager_id = '${dealScope.managerId}'`
      : '';

    // ──── SALES ────
    const [
      salesRevenueAgg,
      salesAvgAgg,
      completedCount,
      totalDealsCount,
      canceledCount,
      revenueByDayRaw,
      dealsByStatus,
      topClientsRaw,
      topProductsRaw,
    ] = await Promise.all([
      // Total revenue in period (COMPLETED + APPROVED + CLOSED deals)
      prisma.deal.aggregate({
        where: { ...dealScope, status: { in: ['SHIPPED', 'CLOSED'] }, isArchived: false, updatedAt: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      // Avg deal amount in period
      prisma.deal.aggregate({
        where: { ...dealScope, status: { in: ['SHIPPED', 'CLOSED'] }, isArchived: false, updatedAt: { gte: start, lt: end } },
        _avg: { amount: true },
      }),
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
      // Revenue by day
      prisma.$queryRawUnsafe<{ day: Date; total: string }[]>(
        `SELECT DATE(d.updated_at) as day, SUM(d.amount)::text as total
         FROM deals d
         WHERE d.status IN ('SHIPPED', 'CLOSED')
           AND d.is_archived = false
           AND d.updated_at >= $1 AND d.updated_at < $2
           ${managerWhere}
         GROUP BY DATE(d.updated_at)
         ORDER BY day ASC`,
        start, end,
      ),
      // Deals by status
      prisma.deal.groupBy({
        by: ['status'],
        where: { ...dealScope, isArchived: false, createdAt: { gte: start, lt: end } },
        _count: true,
      }),
      // Top 5 clients by revenue
      prisma.$queryRawUnsafe<{ client_id: string; company_name: string; total_revenue: string }[]>(
        `SELECT c.id as client_id, c.company_name, SUM(d.amount)::text as total_revenue
         FROM deals d
         JOIN clients c ON c.id = d.client_id
         WHERE d.status IN ('SHIPPED', 'CLOSED')
           AND d.is_archived = false
           AND d.updated_at >= $1 AND d.updated_at < $2
           ${managerWhere}
         GROUP BY c.id, c.company_name
         ORDER BY SUM(d.amount) DESC
         LIMIT 5`,
        start, end,
      ),
      // Top 5 products by quantity sold
      prisma.$queryRawUnsafe<{ product_id: string; name: string; total_quantity: string }[]>(
        `SELECT p.id as product_id, p.name, SUM(m.quantity)::text as total_quantity
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.type = 'OUT'
           AND m.created_at >= $1 AND m.created_at < $2
         GROUP BY p.id, p.name
         ORDER BY SUM(m.quantity) DESC
         LIMIT 5`,
        start, end,
      ),
    ]);

    const revenueByDay = revenueByDayRaw.map((r) => {
      const d = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
      return { day: d, total: Number(r.total) };
    });

    const sales = {
      totalRevenue: salesRevenueAgg._sum.amount ? Number(salesRevenueAgg._sum.amount) : 0,
      avgDealAmount: salesAvgAgg._avg.amount ? Number(salesAvgAgg._avg.amount) : 0,
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
      prisma.$queryRawUnsafe<{ debt: string }[]>(
        `SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt
         FROM deals d
         WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
           AND d.is_archived = false
           ${managerWhere}`,
      ),
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
      prisma.$queryRawUnsafe<{ client_id: string; company_name: string; total_debt: string }[]>(
        `SELECT c.id as client_id, c.company_name, SUM(d.amount - d.paid_amount)::text as total_debt
         FROM deals d
         JOIN clients c ON c.id = d.client_id
         WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
           AND d.is_archived = false
           ${managerWhere}
         GROUP BY c.id, c.company_name
         ORDER BY SUM(d.amount - d.paid_amount) DESC
         LIMIT 10`,
      ),
      prisma.deal.aggregate({
        where: { ...dealScope, status: { in: ['SHIPPED', 'CLOSED'] }, isArchived: false },
        _sum: { paidAmount: true },
      }),
      prisma.deal.aggregate({
        where: { ...dealScope, status: { in: ['SHIPPED', 'CLOSED'] }, isArchived: false },
        _sum: { amount: true },
      }),
    ]);

    const finance = {
      totalDebt: totalDebtRaw[0] ? Number(totalDebtRaw[0].debt) : 0,
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
      paperTurnover: paperTurnoverAgg._sum.amount ? Number(paperTurnoverAgg._sum.amount) : 0,
    };

    // ──── WAREHOUSE ────
    const [belowMinStockRaw, deadStockRaw, topSellingRaw, frozenCapitalRaw] = await Promise.all([
      prisma.$queryRawUnsafe<{ id: string; name: string; sku: string; stock: number; min_stock: number }[]>(
        `SELECT id, name, sku, stock, min_stock
         FROM products
         WHERE is_active = true AND stock < min_stock AND stock >= 0
         ORDER BY stock ASC`,
      ),
      prisma.$queryRawUnsafe<{ id: string; name: string; sku: string; stock: number; last_out_date: Date | null }[]>(
        `SELECT p.id, p.name, p.sku, p.stock,
                MAX(m.created_at) as last_out_date
         FROM products p
         LEFT JOIN inventory_movements m ON m.product_id = p.id AND m.type = 'OUT'
         WHERE p.is_active = true AND p.stock > 0
         GROUP BY p.id, p.name, p.sku, p.stock
         HAVING MAX(m.created_at) IS NULL OR MAX(m.created_at) < NOW() - INTERVAL '30 days'
         ORDER BY p.stock DESC`,
      ),
      prisma.$queryRawUnsafe<{ product_id: string; name: string; total_sold: string }[]>(
        `SELECT p.id as product_id, p.name, SUM(m.quantity)::text as total_sold
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.type = 'OUT'
         GROUP BY p.id, p.name
         ORDER BY SUM(m.quantity) DESC
         LIMIT 10`,
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
      prisma.$queryRawUnsafe<{
        manager_id: string; full_name: string;
        completed_count: string; total_revenue: string; avg_deal_amount: string;
        total_deals: string;
      }[]>(
        `SELECT
           d.manager_id,
           u.full_name,
           COUNT(*) FILTER (WHERE d.status IN ('SHIPPED', 'CLOSED'))::text as completed_count,
           COALESCE(SUM(d.amount) FILTER (WHERE d.status IN ('SHIPPED', 'CLOSED')), 0)::text as total_revenue,
           COALESCE(AVG(d.amount) FILTER (WHERE d.status IN ('SHIPPED', 'CLOSED')), 0)::text as avg_deal_amount,
           COUNT(*)::text as total_deals
         FROM deals d
         JOIN users u ON u.id = d.manager_id
         WHERE d.is_archived = false
         GROUP BY d.manager_id, u.full_name
         ORDER BY SUM(d.amount) FILTER (WHERE d.status IN ('SHIPPED', 'CLOSED')) DESC NULLS LAST`,
      ),
      prisma.$queryRawUnsafe<{ manager_id: string; avg_days: string }[]>(
        `SELECT
           d.manager_id,
           AVG(EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) / 86400)::text as avg_days
         FROM deals d
         WHERE d.status IN ('SHIPPED', 'CLOSED') AND d.is_archived = false
         GROUP BY d.manager_id`,
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
      prisma.$queryRawUnsafe<{ total: string }[]>(
        `SELECT COALESCE(SUM(p.amount), 0)::text as total
         FROM payments p
         WHERE p.paid_at >= $1 AND p.paid_at < $2`,
        start, end,
      ),
      prisma.$queryRawUnsafe<{ total: string }[]>(
        `SELECT COALESCE(SUM(di.requested_qty * pr.purchase_price), 0)::text as total
         FROM deal_items di
         JOIN deals d ON d.id = di.deal_id
         JOIN products pr ON pr.id = di.product_id
         WHERE d.status IN ('SHIPPED', 'CLOSED')
           AND d.is_archived = false
           AND d.updated_at >= $1 AND d.updated_at < $2
           AND di.requested_qty IS NOT NULL
           AND pr.purchase_price IS NOT NULL`,
        start, end,
      ),
      prisma.$queryRawUnsafe<{ total: string }[]>(
        `SELECT COALESCE(SUM(amount), 0)::text as total
         FROM expenses
         WHERE date >= $1 AND date < $2`,
        start, end,
      ),
      prisma.$queryRawUnsafe<{ category: string; total: string }[]>(
        `SELECT category, SUM(amount)::text as total
         FROM expenses
         WHERE date >= $1 AND date < $2
         GROUP BY category
         ORDER BY SUM(amount) DESC`,
        start, end,
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
