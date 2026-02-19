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

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(startOfToday);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      revenueTodayAgg,
      revenueYesterdayAgg,
      revenueMonthAgg,
      activeDealsCount,
      totalDebtRaw,
      zeroStockProducts,
      lowStockProducts,
      closedDealsToday,
      closedDealsYesterday,
      revenueLast30DaysRaw,
      dealsByStatusCounts,
    ] = await Promise.all([
      // 1. Revenue today (from payments)
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
             FROM payments p
             WHERE p.paid_at >= ${startOfToday} AND p.paid_at < ${startOfTomorrow}
             AND p.deal_id IN (SELECT id FROM deals WHERE manager_id = ${dealScope.managerId})`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
             FROM payments p
             WHERE p.paid_at >= ${startOfToday} AND p.paid_at < ${startOfTomorrow}`
          ),

      // 2. Revenue yesterday (for delta)
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
             FROM payments p
             WHERE p.paid_at >= ${startOfYesterday} AND p.paid_at < ${startOfToday}
             AND p.deal_id IN (SELECT id FROM deals WHERE manager_id = ${dealScope.managerId})`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
             FROM payments p
             WHERE p.paid_at >= ${startOfYesterday} AND p.paid_at < ${startOfToday}`
          ),

      // 3. Revenue this month (from payments, consistent with daily)
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
             FROM payments p
             WHERE p.paid_at >= ${startOfMonth} AND p.paid_at < ${startOfTomorrow}
             AND p.deal_id IN (SELECT id FROM deals WHERE manager_id = ${dealScope.managerId})`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
             FROM payments p
             WHERE p.paid_at >= ${startOfMonth} AND p.paid_at < ${startOfTomorrow}`
          ),

      // 4. Active deals count
      prisma.deal.count({
        where: {
          ...dealScope,
          status: { in: ['NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED', 'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT', 'SHIPMENT_ON_HOLD', 'SHIPPED'] },
          isArchived: false,
        },
      }),

      // 5. Total debt (exclude CANCELED/REJECTED)
      dealScope.managerId
        ? prisma.$queryRaw<{ debt: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt
             FROM deals d
             WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
               AND d.is_archived = false
               AND d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.manager_id = ${dealScope.managerId}`
          )
        : prisma.$queryRaw<{ debt: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt
             FROM deals d
             WHERE d.payment_status IN ('UNPAID', 'PARTIAL')
               AND d.is_archived = false
               AND d.status NOT IN ('CANCELED', 'REJECTED')`
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

      // 10. Revenue last 30 days (from payments)
      dealScope.managerId
        ? prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT DATE(p.paid_at) as day, SUM(p.amount)::text as total
             FROM payments p
             WHERE p.paid_at >= ${thirtyDaysAgo} AND p.paid_at < ${startOfTomorrow}
             AND p.deal_id IN (SELECT id FROM deals WHERE manager_id = ${dealScope.managerId})
             GROUP BY DATE(p.paid_at)
             ORDER BY day ASC`
          )
        : prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT DATE(p.paid_at) as day, SUM(p.amount)::text as total
             FROM payments p
             WHERE p.paid_at >= ${thirtyDaysAgo} AND p.paid_at < ${startOfTomorrow}
             GROUP BY DATE(p.paid_at)
             ORDER BY day ASC`
          ),

      // 11. Deals by status counts
      prisma.deal.groupBy({
        by: ['status'],
        where: { ...dealScope, isArchived: false },
        _count: true,
      }),
    ]);

    const lowStockMapped = lowStockProducts.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      stock: Number(p.stock),
      minStock: Number(p.min_stock),
    }));

    res.json({
      revenueToday: revenueTodayAgg[0] ? Number(revenueTodayAgg[0].total) : 0,
      revenueYesterday: revenueYesterdayAgg[0] ? Number(revenueYesterdayAgg[0].total) : 0,
      revenueMonth: revenueMonthAgg[0] ? Number(revenueMonthAgg[0].total) : 0,
      activeDealsCount,
      totalDebt: totalDebtRaw[0] ? Number(totalDebtRaw[0].debt) : 0,
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
    });
  }),
);

// ──── Revenue Today drilldown ────
router.get(
  '/revenue-today',
  asyncHandler(async (req: Request, res: Response) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const payments = await prisma.payment.findMany({
      where: {
        paidAt: { gte: startOfToday, lt: startOfTomorrow },
      },
      include: {
        deal: { select: { id: true, title: true } },
        client: { select: { id: true, companyName: true } },
        creator: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
    });

    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    res.json({ payments, total });
  }),
);

export { router as dashboardRoutes };
