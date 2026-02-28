import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

router.use(authenticate);

// 00:00 Asia/Tashkent = 19:00 UTC previous day  (UTC+5)
const YEAR_START = new Date('2024-12-31T19:00:00Z'); // 2025-01-01 00:00 Tashkent
const YEAR_END = new Date('2025-12-31T19:00:00Z');   // 2026-01-01 00:00 Tashkent
const TZ = Prisma.sql`'Asia/Tashkent'`;

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    // ── 1. Overview KPIs ──
    const overviewRaw = await prisma.$queryRaw<
      {
        total_deals: string;
        total_clients: string;
        total_revenue: string;
        avg_deal: string;
      }[]
    >(
      Prisma.sql`SELECT
        COUNT(DISTINCT d.id)::text as total_deals,
        COUNT(DISTINCT d.client_id)::text as total_clients,
        COALESCE(SUM(d.amount), 0)::text as total_revenue,
        COALESCE(AVG(d.amount), 0)::text as avg_deal
      FROM deals d
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false`,
    );

    // Total collected in 2025 (from payments table by paid_at)
    const collectedRaw = await prisma.$queryRaw<{ total_paid: string }[]>(
      Prisma.sql`SELECT COALESCE(SUM(amount), 0)::text as total_paid
      FROM payments WHERE paid_at >= ${YEAR_START} AND paid_at < ${YEAR_END}`,
    );

    // Outstanding debt across ALL years (not just 2025)
    const debtRaw = await prisma.$queryRaw<{ total_debt: string }[]>(
      Prisma.sql`SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as total_debt
      FROM deals d
      WHERE d.is_archived = false AND d.payment_status IN ('UNPAID', 'PARTIAL')`,
    );

    const ov = overviewRaw[0];
    const overview = {
      totalDeals: Number(ov.total_deals),
      totalClients: Number(ov.total_clients),
      totalRevenue: Number(ov.total_revenue),
      totalPaid: Number(collectedRaw[0].total_paid),
      totalDebt: Number(debtRaw[0].total_debt),
      avgDeal: Math.round(Number(ov.avg_deal)),
    };

    // ── 2. Monthly trend ──
    // Revenue grouped by deal creation month (Tashkent TZ)
    const revenueByMonthRaw = await prisma.$queryRaw<
      { month: number; revenue: string; active_clients: string }[]
    >(
      Prisma.sql`SELECT
        EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COUNT(DISTINCT d.client_id)::text as active_clients
      FROM deals d
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
      GROUP BY EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})
      ORDER BY month`,
    );

    // Collected grouped by payment date month (Tashkent TZ) — NOT by deal creation
    const collectedByMonthRaw = await prisma.$queryRaw<
      { month: number; collected: string }[]
    >(
      Prisma.sql`SELECT
        EXTRACT(MONTH FROM p.paid_at AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(p.amount), 0)::text as collected
      FROM payments p
      WHERE p.paid_at >= ${YEAR_START} AND p.paid_at < ${YEAR_END}
      GROUP BY EXTRACT(MONTH FROM p.paid_at AT TIME ZONE ${TZ})
      ORDER BY month`,
    );
    const collectedMap = new Map(collectedByMonthRaw.map((r) => [r.month, Number(r.collected)]));

    // Opening/closing balance per month — snapshot of total outstanding debt
    // Uses payments table for accurate point-in-time calculation (ALL deals, any year)
    const balanceRaw = await prisma.$queryRaw<
      { month: number; opening_balance: string; closing_balance: string }[]
    >(
      Prisma.sql`SELECT m as month,
        (SELECT COALESCE(SUM(GREATEST(d.amount - COALESCE(
          (SELECT SUM(p.amount) FROM payments p WHERE p.deal_id = d.id
           AND p.paid_at < make_timestamptz(2025, m, 1, 0, 0, 0, ${TZ})),
          0), 0)), 0)
         FROM deals d
         WHERE d.is_archived = false
           AND d.created_at < make_timestamptz(2025, m, 1, 0, 0, 0, ${TZ})
        )::text as opening_balance,
        (SELECT COALESCE(SUM(GREATEST(d.amount - COALESCE(
          (SELECT SUM(p.amount) FROM payments p WHERE p.deal_id = d.id
           AND p.paid_at < make_timestamptz(2025, m, 1, 0, 0, 0, ${TZ}) + interval '1 month'),
          0), 0)), 0)
         FROM deals d
         WHERE d.is_archived = false
           AND d.created_at < make_timestamptz(2025, m, 1, 0, 0, 0, ${TZ}) + interval '1 month'
        )::text as closing_balance
      FROM generate_series(1, 12) as m
      ORDER BY m`,
    );
    const balanceMap = new Map(balanceRaw.map((r) => [r.month, { opening: Number(r.opening_balance), closing: Number(r.closing_balance) }]));

    const monthlyTrend = revenueByMonthRaw.map((r) => ({
      month: r.month,
      revenue: Number(r.revenue),
      collected: collectedMap.get(r.month) ?? 0,
      activeClients: Number(r.active_clients),
      openingBalance: balanceMap.get(r.month)?.opening ?? 0,
      closingBalance: balanceMap.get(r.month)?.closing ?? 0,
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
        AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL
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
      WHERE d.is_archived = false
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

    // ── 8. Client activity matrix (with revenue per month) ──
    const clientActivityRaw = await prisma.$queryRaw<
      { client_id: string; company_name: string; month: number; revenue: string }[]
    >(
      Prisma.sql`SELECT
        c.id as client_id,
        c.company_name,
        EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(d.amount), 0)::text as revenue
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END}
        AND d.is_archived = false
      GROUP BY c.id, c.company_name, EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})
      ORDER BY c.company_name, month`,
    );
    const activityMap = new Map<string, { clientId: string; companyName: string; activeMonths: number[]; monthlyData: { month: number; revenue: number }[] }>();
    for (const row of clientActivityRaw) {
      const existing = activityMap.get(row.client_id);
      if (existing) {
        existing.activeMonths.push(row.month);
        existing.monthlyData.push({ month: row.month, revenue: Number(row.revenue) });
      } else {
        activityMap.set(row.client_id, {
          clientId: row.client_id,
          companyName: row.company_name,
          activeMonths: [row.month],
          monthlyData: [{ month: row.month, revenue: Number(row.revenue) }],
        });
      }
    }
    const clientActivity = Array.from(activityMap.values());

    res.json({
      overview,
      monthlyTrend,
      topClients,
      topProducts,
      managers,
      paymentMethods,
      debtors,
      clientActivity,
    });
  }),
);

// ── Drilldown endpoint ──
router.get(
  '/drilldown',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const type = req.query.type as string;
    const managerId = req.query.managerId as string | undefined;
    const method = req.query.method as string | undefined;

    if (type === 'deals') {
      const managerFilter = managerId ? Prisma.sql` AND d.manager_id = ${managerId}` : Prisma.sql``;
      const dealsRaw = await prisma.$queryRaw<
        {
          id: string;
          title: string;
          amount: string;
          paid_amount: string;
          payment_status: string;
          status: string;
          created_at: Date;
          company_name: string;
          manager_name: string;
        }[]
      >(
        Prisma.sql`SELECT d.id, d.title, d.amount::text, d.paid_amount::text,
          d.payment_status, d.status, d.created_at,
          c.company_name, u.full_name as manager_name
        FROM deals d
        JOIN clients c ON c.id = d.client_id
        JOIN users u ON u.id = d.manager_id
        WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END}
          AND d.is_archived = false${managerFilter}
        ORDER BY d.amount DESC
        LIMIT 100`,
      );
      res.json({
        deals: dealsRaw.map((d) => ({
          id: d.id,
          title: d.title,
          amount: Number(d.amount),
          paidAmount: Number(d.paid_amount),
          paymentStatus: d.payment_status,
          status: d.status,
          createdAt: d.created_at,
          companyName: d.company_name,
          managerName: d.manager_name,
        })),
      });
      return;
    }

    if (type === 'payments') {
      const methodFilter = method ? Prisma.sql` AND COALESCE(p.method, 'Не указан') = ${method}` : Prisma.sql``;
      const paymentsRaw = await prisma.$queryRaw<
        {
          id: string;
          amount: string;
          paid_at: Date;
          method: string;
          deal_title: string;
          company_name: string;
        }[]
      >(
        Prisma.sql`SELECT p.id, p.amount::text, p.paid_at,
          COALESCE(p.method, 'Не указан') as method,
          d.title as deal_title, c.company_name
        FROM payments p
        JOIN deals d ON d.id = p.deal_id
        JOIN clients c ON c.id = p.client_id
        WHERE p.paid_at >= ${YEAR_START} AND p.paid_at < ${YEAR_END}${methodFilter}
        ORDER BY p.amount DESC
        LIMIT 100`,
      );
      res.json({
        payments: paymentsRaw.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paidAt: p.paid_at,
          method: p.method,
          dealTitle: p.deal_title,
          companyName: p.company_name,
        })),
      });
      return;
    }

    res.status(400).json({ error: 'Invalid type' });
  }),
);

// ── Month detail endpoint ──
router.get(
  '/month/:month',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const month = parseInt(req.params.month as string, 10);
    if (isNaN(month) || month < 1 || month > 12) {
      res.status(400).json({ error: 'Invalid month' });
      return;
    }

    const dealsRaw = await prisma.$queryRaw<
      {
        id: string;
        title: string;
        amount: string;
        paid_amount: string;
        payment_status: string;
        status: string;
        created_at: Date;
        company_name: string;
        manager_name: string;
      }[]
    >(
      Prisma.sql`SELECT d.id, d.title, d.amount::text, d.paid_amount::text,
        d.payment_status, d.status, d.created_at,
        c.company_name, u.full_name as manager_name
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      JOIN users u ON u.id = d.manager_id
      WHERE EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ}) = ${month}
        AND d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END}
        AND d.is_archived = false
      ORDER BY d.amount DESC`,
    );

    const productsRaw = await prisma.$queryRaw<
      { id: string; name: string; qty: string; revenue: string }[]
    >(
      Prisma.sql`SELECT p.id, p.name,
        SUM(di.requested_qty)::text as qty,
        SUM(di.price * di.requested_qty)::text as revenue
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      WHERE EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ}) = ${month}
        AND d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END}
        AND d.is_archived = false
        AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL
      GROUP BY p.id, p.name
      ORDER BY SUM(di.requested_qty) DESC
      LIMIT 10`,
    );

    const managersRaw = await prisma.$queryRaw<
      { id: string; full_name: string; deals_count: string; revenue: string }[]
    >(
      Prisma.sql`SELECT u.id, u.full_name,
        COUNT(d.id)::text as deals_count,
        SUM(d.amount)::text as revenue
      FROM deals d
      JOIN users u ON u.id = d.manager_id
      WHERE EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ}) = ${month}
        AND d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END}
        AND d.is_archived = false
      GROUP BY u.id, u.full_name
      ORDER BY SUM(d.amount) DESC`,
    );

    res.json({
      deals: dealsRaw.map((d) => ({
        id: d.id,
        title: d.title,
        amount: Number(d.amount),
        paidAmount: Number(d.paid_amount),
        paymentStatus: d.payment_status,
        status: d.status,
        createdAt: d.created_at,
        companyName: d.company_name,
        managerName: d.manager_name,
      })),
      products: productsRaw.map((p) => ({
        id: p.id,
        name: p.name,
        qty: Math.round(Number(p.qty) * 100) / 100,
        revenue: Number(p.revenue),
      })),
      managers: managersRaw.map((m) => ({
        id: m.id,
        fullName: m.full_name,
        dealsCount: Number(m.deals_count),
        revenue: Number(m.revenue),
      })),
    });
  }),
);

// ── Extended analytics endpoint ──
router.get(
  '/extended',
  asyncHandler(async (_req: Request, res: Response) => {
    // 1. Retention (month-over-month)
    const retentionRaw = await prisma.$queryRaw<
      { month: number; total_clients: string; retained_clients: string }[]
    >(
      Prisma.sql`WITH monthly_clients AS (
        SELECT DISTINCT client_id, EXTRACT(MONTH FROM created_at AT TIME ZONE ${TZ})::int as month
        FROM deals
        WHERE created_at >= ${YEAR_START} AND created_at < ${YEAR_END} AND is_archived = false
      )
      SELECT a.month,
        COUNT(DISTINCT a.client_id)::text as total_clients,
        COUNT(DISTINCT b.client_id)::text as retained_clients
      FROM monthly_clients a
      LEFT JOIN monthly_clients b ON a.client_id = b.client_id AND b.month = a.month + 1
      WHERE a.month < 12
      GROUP BY a.month
      ORDER BY a.month`,
    );
    const retention = retentionRaw.map((r) => {
      const total = Number(r.total_clients);
      const retained = Number(r.retained_clients);
      return {
        month: r.month,
        totalClients: total,
        retainedClients: retained,
        retentionRate: total > 0 ? Math.round((retained / total) * 100) / 100 : 0,
      };
    });

    // 2. Revenue concentration
    const concentrationRaw = await prisma.$queryRaw<
      { id: string; company_name: string; revenue: string; running_total: string; grand_total: string }[]
    >(
      Prisma.sql`WITH client_revenue AS (
        SELECT c.id, c.company_name, COALESCE(SUM(d.amount), 0) as revenue
        FROM deals d JOIN clients c ON c.id = d.client_id
        WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
        GROUP BY c.id, c.company_name
        ORDER BY SUM(d.amount) DESC
      )
      SELECT id, company_name,
        revenue::text,
        SUM(revenue) OVER (ORDER BY revenue DESC)::text as running_total,
        (SELECT SUM(revenue) FROM client_revenue)::text as grand_total
      FROM client_revenue
      LIMIT 20`,
    );
    const concentration = concentrationRaw.map((r, i) => ({
      clientId: r.id,
      companyName: r.company_name,
      revenue: Number(r.revenue),
      cumulativePercent: Number(r.grand_total) > 0
        ? Math.round((Number(r.running_total) / Number(r.grand_total)) * 10000) / 100
        : 0,
      rank: i + 1,
    }));

    // 3. Product recurring
    const productRecurringRaw = await prisma.$queryRaw<
      { product_id: string; name: string; months_active: string; total_buyers: string; recurring_buyers: string }[]
    >(
      Prisma.sql`WITH product_months AS (
        SELECT di.product_id, p.name,
          EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})::int as month,
          d.client_id
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN products p ON p.id = di.product_id
        WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
          AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL
      ),
      product_stats AS (
        SELECT product_id, name,
          COUNT(DISTINCT month)::text as months_active,
          COUNT(DISTINCT client_id)::text as total_buyers
        FROM product_months
        GROUP BY product_id, name
      ),
      recurring_buyers AS (
        SELECT product_id, COUNT(*)::text as recurring_buyers
        FROM (
          SELECT product_id, client_id
          FROM product_months
          GROUP BY product_id, client_id
          HAVING COUNT(DISTINCT month) >= 2
        ) sub
        GROUP BY product_id
      )
      SELECT ps.product_id, ps.name, ps.months_active, ps.total_buyers,
        COALESCE(rb.recurring_buyers, '0') as recurring_buyers
      FROM product_stats ps
      LEFT JOIN recurring_buyers rb ON rb.product_id = ps.product_id
      WHERE ps.months_active::int >= 2
      ORDER BY ps.months_active::int DESC, COALESCE(rb.recurring_buyers, '0')::int DESC
      LIMIT 20`,
    );
    const productRecurring = productRecurringRaw.map((r) => {
      const totalBuyers = Number(r.total_buyers);
      const recurringBuyers = Number(r.recurring_buyers);
      return {
        productId: r.product_id,
        name: r.name,
        monthsActive: Number(r.months_active),
        totalBuyers,
        recurringBuyers,
        recurringRate: totalBuyers > 0 ? Math.round((recurringBuyers / totalBuyers) * 100) / 100 : 0,
      };
    });

    // 4. Manager trend
    const managerTrendRaw = await prisma.$queryRaw<
      { manager_id: string; full_name: string; month: number; revenue: string; deals_count: string }[]
    >(
      Prisma.sql`SELECT d.manager_id, u.full_name,
        EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COUNT(d.id)::text as deals_count
      FROM deals d
      JOIN users u ON u.id = d.manager_id
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
      GROUP BY d.manager_id, u.full_name, EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})
      ORDER BY u.full_name, month`,
    );
    const managerTrend = managerTrendRaw.map((r) => ({
      managerId: r.manager_id,
      fullName: r.full_name,
      month: r.month,
      revenue: Number(r.revenue),
      dealsCount: Number(r.deals_count),
    }));

    // 5. Cohort analysis
    const cohortRaw = await prisma.$queryRaw<
      { cohort_month: number; active_month: number; client_count: string; revenue_total: string }[]
    >(
      Prisma.sql`WITH first_deal AS (
        SELECT client_id, MIN(EXTRACT(MONTH FROM created_at AT TIME ZONE ${TZ}))::int as cohort_month
        FROM deals
        WHERE created_at >= ${YEAR_START} AND created_at < ${YEAR_END} AND is_archived = false
        GROUP BY client_id
      ),
      monthly_activity AS (
        SELECT d.client_id,
          EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})::int as active_month,
          SUM(d.amount) as revenue
        FROM deals d
        WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
        GROUP BY d.client_id, EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})
      )
      SELECT f.cohort_month, ma.active_month,
        COUNT(DISTINCT ma.client_id)::text as client_count,
        COALESCE(SUM(ma.revenue), 0)::text as revenue_total
      FROM first_deal f
      JOIN monthly_activity ma ON ma.client_id = f.client_id
      GROUP BY f.cohort_month, ma.active_month
      ORDER BY f.cohort_month, ma.active_month`,
    );
    const cohort = cohortRaw.map((r) => ({
      cohortMonth: r.cohort_month,
      activeMonth: r.active_month,
      clientCount: Number(r.client_count),
      revenueTotal: Number(r.revenue_total),
    }));

    // 6. Debt risk
    const debtRiskRaw = await prisma.$queryRaw<
      { id: string; company_name: string; debt: string; revenue: string; debt_ratio: string; last_deal_month: number }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        CASE WHEN SUM(d.amount) > 0
          THEN (SUM(d.amount - d.paid_amount)::numeric / SUM(d.amount)::numeric)::text
          ELSE '0'
        END as debt_ratio,
        MAX(EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ}))::int as last_deal_month
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
        AND d.payment_status IN ('UNPAID', 'PARTIAL')
      GROUP BY c.id, c.company_name
      HAVING SUM(d.amount - d.paid_amount) > 0
      ORDER BY SUM(d.amount - d.paid_amount) DESC
      LIMIT 30`,
    );
    const debtRisk = debtRiskRaw.map((r) => ({
      clientId: r.id,
      companyName: r.company_name,
      debt: Number(r.debt),
      revenue: Number(r.revenue),
      debtRatio: Math.round(Number(r.debt_ratio) * 100) / 100,
      lastDealMonth: r.last_deal_month,
    }));

    // 7. Seasonality
    const seasonalityRaw = await prisma.$queryRaw<
      { month: number; revenue: string; deals_count: string; avg_deal_size: string }[]
    >(
      Prisma.sql`SELECT EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COUNT(d.id)::text as deals_count,
        COALESCE(AVG(d.amount), 0)::text as avg_deal_size
      FROM deals d
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
      GROUP BY EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ})
      ORDER BY month`,
    );
    const seasonality = seasonalityRaw.map((r) => ({
      month: r.month,
      revenue: Number(r.revenue),
      dealsCount: Number(r.deals_count),
      avgDealSize: Math.round(Number(r.avg_deal_size)),
    }));

    // 8. Client segments (RFM-style)
    const segmentRaw = await prisma.$queryRaw<
      { id: string; company_name: string; deals_count: string; total_revenue: string; last_active_month: number }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        COUNT(d.id)::text as deals_count,
        COALESCE(SUM(d.amount), 0)::text as total_revenue,
        MAX(EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ}))::int as last_active_month
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END} AND d.is_archived = false
      GROUP BY c.id, c.company_name`,
    );

    // Get active months per client for segment calculation
    const activeMonthsRaw = await prisma.$queryRaw<
      { client_id: string; month: number }[]
    >(
      Prisma.sql`SELECT DISTINCT client_id, EXTRACT(MONTH FROM created_at AT TIME ZONE ${TZ})::int as month
      FROM deals
      WHERE created_at >= ${YEAR_START} AND created_at < ${YEAR_END} AND is_archived = false`,
    );
    const clientMonthsMap = new Map<string, number[]>();
    for (const row of activeMonthsRaw) {
      const existing = clientMonthsMap.get(row.client_id);
      if (existing) existing.push(row.month);
      else clientMonthsMap.set(row.client_id, [row.month]);
    }

    // Calculate revenue threshold for VIP (top 20%)
    const revenues = segmentRaw.map((r) => Number(r.total_revenue)).sort((a, b) => b - a);
    const vipThreshold = revenues[Math.floor(revenues.length * 0.2)] || 0;

    function computeSegment(dealsCount: number, totalRevenue: number, lastMonth: number, monthsCount: number): string {
      if (totalRevenue >= vipThreshold && dealsCount >= 5) return 'VIP';
      if (monthsCount >= 4) return 'Regular';
      if (monthsCount >= 2 && lastMonth >= 9) return 'New';
      if (monthsCount <= 2 && lastMonth <= 6) return 'Churned';
      return 'At-Risk';
    }

    const clientSegments = segmentRaw.map((r) => {
      const months = clientMonthsMap.get(r.id) || [];
      return {
        clientId: r.id,
        companyName: r.company_name,
        segment: computeSegment(Number(r.deals_count), Number(r.total_revenue), r.last_active_month, months.length),
        totalRevenue: Number(r.total_revenue),
        dealsCount: Number(r.deals_count),
        lastActiveMonth: r.last_active_month,
        activeMonths: months.sort((a, b) => a - b),
      };
    });

    // Segment summary
    const segmentCounts = new Map<string, { count: number; totalRevenue: number }>();
    for (const cs of clientSegments) {
      const existing = segmentCounts.get(cs.segment);
      if (existing) {
        existing.count++;
        existing.totalRevenue += cs.totalRevenue;
      } else {
        segmentCounts.set(cs.segment, { count: 1, totalRevenue: cs.totalRevenue });
      }
    }
    const segmentSummary = Array.from(segmentCounts.entries()).map(([segment, data]) => ({
      segment,
      count: data.count,
      totalRevenue: data.totalRevenue,
    }));

    res.json({
      retention,
      concentration,
      productRecurring,
      managerTrend,
      cohort,
      debtRisk,
      seasonality,
      clientSegments,
      segmentSummary,
    });
  }),
);

// ── Client-month purchases endpoint ──
router.get(
  '/client-month/:clientId/:month',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const clientId = req.params.clientId as string;
    const month = parseInt(req.params.month as string, 10);
    if (isNaN(month) || month < 1 || month > 12) {
      res.status(400).json({ error: 'Invalid month' });
      return;
    }

    const itemsRaw = await prisma.$queryRaw<
      {
        id: string;
        product_name: string;
        unit: string;
        qty: string;
        price: string;
        total: string;
        deal_title: string;
        deal_id: string;
      }[]
    >(
      Prisma.sql`SELECT di.id, p.name as product_name, p.unit,
        COALESCE(di.requested_qty, 0)::text as qty, COALESCE(di.price, 0)::text as price,
        (COALESCE(di.requested_qty, 0) * COALESCE(di.price, 0))::text as total,
        d.title as deal_title, d.id as deal_id
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      WHERE d.client_id = ${clientId}
        AND EXTRACT(MONTH FROM d.created_at AT TIME ZONE ${TZ}) = ${month}
        AND d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END}
        AND d.is_archived = false
        AND di.requested_qty IS NOT NULL AND di.price IS NOT NULL
      ORDER BY (COALESCE(di.requested_qty, 0) * COALESCE(di.price, 0)) DESC`,
    );

    const items = itemsRaw.map((r) => ({
      id: r.id,
      productName: r.product_name,
      unit: r.unit,
      qty: Math.round(Number(r.qty) * 100) / 100,
      price: Number(r.price),
      total: Number(r.total),
      dealTitle: r.deal_title,
      dealId: r.deal_id,
    }));

    res.json({
      items,
      totalRevenue: items.reduce((sum, i) => sum + i.total, 0),
    });
  }),
);

// ── Product buyers endpoint ──
router.get(
  '/product-buyers/:productId',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const productId = req.params.productId as string;

    const productInfo = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } });

    const buyersRaw = await prisma.$queryRaw<
      {
        id: string;
        company_name: string;
        total_qty: string;
        total_revenue: string;
        deals_count: string;
      }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        SUM(di.requested_qty)::text as total_qty,
        SUM(di.requested_qty * di.price)::text as total_revenue,
        COUNT(DISTINCT d.id)::text as deals_count
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN clients c ON c.id = d.client_id
      WHERE di.product_id = ${productId}
        AND d.created_at >= ${YEAR_START} AND d.created_at < ${YEAR_END}
        AND d.is_archived = false
        AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL
      GROUP BY c.id, c.company_name
      ORDER BY SUM(di.requested_qty * di.price) DESC`,
    );

    res.json({
      productName: productInfo?.name || 'Неизвестный товар',
      buyers: buyersRaw.map((r) => ({
        clientId: r.id,
        companyName: r.company_name,
        totalQty: Math.round(Number(r.total_qty) * 100) / 100,
        totalRevenue: Number(r.total_revenue),
        dealsCount: Number(r.deals_count),
      })),
    });
  }),
);

// ── Cashflow endpoint ──
router.get(
  '/cashflow',
  asyncHandler(async (_req: Request, res: Response) => {
    // Monthly collected (by payment date, not deal creation)
    const monthlyRaw = await prisma.$queryRaw<
      { month: number; collected: string; payments_count: string }[]
    >(
      Prisma.sql`SELECT
        EXTRACT(MONTH FROM p.paid_at AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(p.amount), 0)::text as collected,
        COUNT(*)::text as payments_count
      FROM payments p
      WHERE p.paid_at >= ${YEAR_START} AND p.paid_at < ${YEAR_END}
      GROUP BY EXTRACT(MONTH FROM p.paid_at AT TIME ZONE ${TZ})
      ORDER BY month`,
    );

    // Top clients by collected amount
    const topClientsRaw = await prisma.$queryRaw<
      { id: string; company_name: string; collected: string; payments_count: string }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        SUM(p.amount)::text as collected,
        COUNT(*)::text as payments_count
      FROM payments p
      JOIN clients c ON c.id = p.client_id
      WHERE p.paid_at >= ${YEAR_START} AND p.paid_at < ${YEAR_END}
      GROUP BY c.id, c.company_name
      ORDER BY SUM(p.amount) DESC
      LIMIT 20`,
    );

    // Totals
    const totalsRaw = await prisma.$queryRaw<
      { total_collected: string; total_payments: string }[]
    >(
      Prisma.sql`SELECT
        COALESCE(SUM(amount), 0)::text as total_collected,
        COUNT(*)::text as total_payments
      FROM payments
      WHERE paid_at >= ${YEAR_START} AND paid_at < ${YEAR_END}`,
    );

    res.json({
      monthly: monthlyRaw.map((r) => ({
        month: r.month,
        collected: Number(r.collected),
        paymentsCount: Number(r.payments_count),
      })),
      topClients: topClientsRaw.map((r) => ({
        id: r.id,
        companyName: r.company_name,
        collected: Number(r.collected),
        paymentsCount: Number(r.payments_count),
      })),
      totalCollected: Number(totalsRaw[0].total_collected),
      totalPayments: Number(totalsRaw[0].total_payments),
    });
  }),
);

export { router as historyRoutes };
