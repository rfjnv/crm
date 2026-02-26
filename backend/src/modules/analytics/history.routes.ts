import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

router.use(authenticate);

const YEAR_START = new Date('2025-01-01T00:00:00Z');
const YEAR_END = new Date('2026-01-01T00:00:00Z');

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    // ── 1. Overview KPIs ──
    const overviewRaw = await prisma.$queryRaw<
      {
        total_deals: string;
        total_clients: string;
        total_revenue: string;
        total_paid: string;
        total_debt: string;
        avg_deal: string;
      }[]
    >(
      Prisma.sql`SELECT
        COUNT(DISTINCT d.id)::text as total_deals,
        COUNT(DISTINCT d.client_id)::text as total_clients,
        COALESCE(SUM(d.amount), 0)::text as total_revenue,
        COALESCE(SUM(d.paid_amount), 0)::text as total_paid,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as total_debt,
        COALESCE(AVG(d.amount), 0)::text as avg_deal
      FROM deals d
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false`,
    );
    const ov = overviewRaw[0];
    const overview = {
      totalDeals: Number(ov.total_deals),
      totalClients: Number(ov.total_clients),
      totalRevenue: Number(ov.total_revenue),
      totalPaid: Number(ov.total_paid),
      totalDebt: Number(ov.total_debt),
      avgDeal: Math.round(Number(ov.avg_deal)),
    };

    // ── 2. Monthly trend ──
    const monthlyRaw = await prisma.$queryRaw<
      { month: number; revenue: string; paid: string; active_clients: string }[]
    >(
      Prisma.sql`SELECT
        EXTRACT(MONTH FROM d.created_at)::int as month,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COALESCE(SUM(d.paid_amount), 0)::text as paid,
        COUNT(DISTINCT d.client_id)::text as active_clients
      FROM deals d
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
      GROUP BY EXTRACT(MONTH FROM d.created_at)
      ORDER BY month`,
    );
    const monthlyTrend = monthlyRaw.map((r) => ({
      month: r.month,
      revenue: Number(r.revenue),
      paid: Number(r.paid),
      activeClients: Number(r.active_clients),
    }));

    // ── 3. Top clients ──
    const topClientsRaw = await prisma.$queryRaw<
      {
        id: string;
        company_name: string;
        deals_count: string;
        revenue: string;
        paid: string;
        debt: string;
      }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        COUNT(d.id)::text as deals_count,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COALESCE(SUM(d.paid_amount), 0)::text as paid,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
      GROUP BY c.id, c.company_name
      ORDER BY SUM(d.amount) DESC
      LIMIT 30`,
    );
    const topClients = topClientsRaw.map((r) => ({
      id: r.id,
      companyName: r.company_name,
      dealsCount: Number(r.deals_count),
      revenue: Number(r.revenue),
      paid: Number(r.paid),
      debt: Number(r.debt),
    }));

    // ── 4. Top products ──
    const topProductsRaw = await prisma.$queryRaw<
      {
        id: string;
        name: string;
        unit: string;
        total_qty: string;
        total_revenue: string;
        unique_buyers: string;
      }[]
    >(
      Prisma.sql`SELECT p.id, p.name, p.unit,
        COALESCE(SUM(di.requested_qty), 0)::text as total_qty,
        COALESCE(SUM(di.price * di.requested_qty), 0)::text as total_revenue,
        COUNT(DISTINCT d.client_id)::text as unique_buyers
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
      GROUP BY p.id, p.name, p.unit
      ORDER BY SUM(di.requested_qty) DESC
      LIMIT 30`,
    );
    const topProducts = topProductsRaw.map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      totalQty: Math.round(Number(r.total_qty) * 100) / 100,
      totalRevenue: Number(r.total_revenue),
      uniqueBuyers: Number(r.unique_buyers),
    }));

    // ── 5. Manager stats ──
    const managersRaw = await prisma.$queryRaw<
      {
        id: string;
        full_name: string;
        deals_count: string;
        revenue: string;
        collected: string;
        clients: string;
      }[]
    >(
      Prisma.sql`SELECT u.id, u.full_name,
        COUNT(d.id)::text as deals_count,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COALESCE(SUM(d.paid_amount), 0)::text as collected,
        COUNT(DISTINCT d.client_id)::text as clients
      FROM deals d
      JOIN users u ON u.id = d.manager_id
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
      GROUP BY u.id, u.full_name
      ORDER BY SUM(d.amount) DESC`,
    );
    const managers = managersRaw.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      dealsCount: Number(r.deals_count),
      revenue: Number(r.revenue),
      collected: Number(r.collected),
      clients: Number(r.clients),
    }));

    // ── 6. Payment methods ──
    const paymentMethodsRaw = await prisma.$queryRaw<
      { method: string; total: string; count: string }[]
    >(
      Prisma.sql`SELECT COALESCE(method, 'Не указан') as method,
        SUM(amount)::text as total,
        COUNT(*)::text as count
      FROM payments
      WHERE paid_at >= ${YEAR_START} AND paid_at < ${YEAR_END}
      GROUP BY COALESCE(method, 'Не указан')
      ORDER BY SUM(amount) DESC`,
    );
    const paymentMethods = paymentMethodsRaw.map((r) => ({
      method: r.method,
      total: Number(r.total),
      count: Number(r.count),
    }));

    // ── 7. Debtors ──
    const debtorsRaw = await prisma.$queryRaw<
      {
        id: string;
        company_name: string;
        total_amount: string;
        total_paid: string;
        debt: string;
      }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        COALESCE(SUM(d.amount), 0)::text as total_amount,
        COALESCE(SUM(d.paid_amount), 0)::text as total_paid,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END}
        AND d.is_archived = false
        AND d.payment_status IN ('UNPAID', 'PARTIAL')
      GROUP BY c.id, c.company_name
      HAVING SUM(d.amount - d.paid_amount) > 0
      ORDER BY SUM(d.amount - d.paid_amount) DESC
      LIMIT 30`,
    );
    const debtors = debtorsRaw.map((r) => ({
      id: r.id,
      companyName: r.company_name,
      totalAmount: Number(r.total_amount),
      totalPaid: Number(r.total_paid),
      debt: Number(r.debt),
    }));

    res.json({
      overview,
      monthlyTrend,
      topClients,
      topProducts,
      managers,
      paymentMethods,
      debtors,
    });
  }),
);

export { router as historyRoutes };
