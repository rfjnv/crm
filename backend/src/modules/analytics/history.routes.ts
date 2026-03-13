import { Router, Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';
import { getSnapshot, saveSnapshot, isPastMonth, isPastYear } from '../../lib/snapshots';

const router = Router();

router.use(authenticate);

const TZ = Prisma.sql`'Asia/Tashkent'`;

// 00:00 Asia/Tashkent = 19:00 UTC previous day  (UTC+5)
function getYearBounds(year: number) {
  const yearStart = new Date(`${year - 1}-12-31T19:00:00Z`); // Jan 1 00:00 Tashkent
  const yearEnd   = new Date(`${year}-12-31T19:00:00Z`);     // Next Jan 1 00:00 Tashkent
  return { yearStart, yearEnd };
}

function parseYear(req: Request): number {
  const raw = req.query.year;
  if (!raw) return new Date().getFullYear();
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2020 || n > 2099) return new Date().getFullYear();
  return n;
}

// ── ACL helpers ──
function extractDealScope(req: Request) {
  const user = {
    userId: req.user!.userId,
    role: req.user!.role as Role,
    permissions: req.user!.permissions || [],
  };
  return ownerScope(user);
}

function buildAclFragments(dealScope: { managerId?: string }) {
  const dealFilter = dealScope.managerId
    ? Prisma.sql` AND d.manager_id = ${dealScope.managerId}`
    : Prisma.sql``;
  const paymentDealJoin = dealScope.managerId
    ? Prisma.sql`JOIN deals d ON d.id = p.deal_id AND d.manager_id = ${dealScope.managerId}`
    : Prisma.sql``;
  return { dealFilter, paymentDealJoin };
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter, paymentDealJoin } = buildAclFragments(dealScope);

    // Snapshot: admin-only, past years
    if (!dealScope.managerId && isPastYear(year)) {
      const cached = await getSnapshot({ year, month: 0, type: 'overview-v5' });
      if (cached) { res.json(cached); return; }
    }

    const { yearStart, yearEnd } = getYearBounds(year);

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
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}`,
    );

    // Total collected (from payments table by paid_at)
    const collectedRaw = await prisma.$queryRaw<{ total_paid: string }[]>(
      Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total_paid
      FROM payments p ${paymentDealJoin}
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
      AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')`,
    );

    // Outstanding debt — use paid_amount from deals (reliable, correctly maintained per deal)
    const debtRaw = await prisma.$queryRaw<{ total_debt: string; total_overpayments: string }[]>(
      Prisma.sql`SELECT
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as total_debt,
        COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as total_overpayments
      FROM deals d
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.created_at < ${yearEnd}${dealFilter}`,
    );

    const ov = overviewRaw[0];
    const debtPositive = Number(debtRaw[0].total_debt);
    const totalOverpayments = Number(debtRaw[0].total_overpayments);

    // Debug mode for debt calculation audit
    const showDebug = req.query.debug === 'true';
    let debtDebug: Record<string, unknown> | undefined;
    if (showDebug) {
      const debugRaw = await prisma.$queryRaw<
        {
          total_deals_amount: string;
          total_paid: string;
          deal_count: string;
          deals_with_debt: string;
          deals_overpaid: string;
        }[]
      >(
        Prisma.sql`SELECT
          COALESCE(SUM(d.amount), 0)::text as total_deals_amount,
          COALESCE(SUM(d.paid_amount), 0)::text as total_paid,
          COUNT(d.id)::text as deal_count,
          COUNT(d.id) FILTER (WHERE d.amount > d.paid_amount)::text as deals_with_debt,
          COUNT(d.id) FILTER (WHERE d.paid_amount > d.amount)::text as deals_overpaid
        FROM deals d
        WHERE d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')
          AND d.created_at < ${yearEnd}${dealFilter}`,
      );
      const dbg = debugRaw[0];
      debtDebug = {
        year,
        cutoffDate: yearEnd.toISOString(),
        totalDealsAmount: Number(dbg.total_deals_amount),
        totalPaid: Number(dbg.total_paid),
        simpleDebt: Number(dbg.total_deals_amount) - Number(dbg.total_paid),
        adjustedDebt: debtPositive,
        totalOverpayments,
        dealCount: Number(dbg.deal_count),
        dealsWithDebt: Number(dbg.deals_with_debt),
        dealsOverpaid: Number(dbg.deals_overpaid),
      };
    }

    const overview = {
      totalDeals: Number(ov.total_deals),
      totalClients: Number(ov.total_clients),
      totalRevenue: Number(ov.total_revenue),
      totalPaid: Number(collectedRaw[0].total_paid),
      totalDebt: debtPositive,
      totalDebtPositive: debtPositive,
      totalOverpayments,
      netBalance: debtPositive - totalOverpayments,
      avgDeal: Math.round(Number(ov.avg_deal)),
    };

    // ── 2. Monthly trend ──
    // Revenue grouped by deal creation month (Tashkent TZ)
    const revenueByMonthRaw = await prisma.$queryRaw<
      { month: number; revenue: string; active_clients: string }[]
    >(
      Prisma.sql`SELECT
        EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COUNT(DISTINCT d.client_id)::text as active_clients
      FROM deals d
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
      ORDER BY month`,
    );

    // Collected grouped by payment date month (Tashkent TZ) — NOT by deal creation
    const collectedByMonthRaw = await prisma.$queryRaw<
      { month: number; collected: string }[]
    >(
      Prisma.sql`SELECT
        EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(p.amount), 0)::text as collected
      FROM payments p ${paymentDealJoin}
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
      AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
      GROUP BY EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
      ORDER BY month`,
    );
    const collectedMap = new Map(collectedByMonthRaw.map((r) => [r.month, Number(r.collected)]));

    // Opening/closing balance per month — use per-client payment sums (client_id is reliable)
    const balanceRaw = await prisma.$queryRaw<
      { month: number; opening_balance: string; closing_balance: string }[]
    >(
      Prisma.sql`WITH client_deals AS (
        SELECT d.client_id,
          SUM(d.amount) FILTER (
            WHERE d.created_at < make_timestamptz(${year}::int, m.month::int, 1, 0, 0, 0, ${TZ})
          ) as amount_at_open,
          SUM(d.amount) FILTER (
            WHERE d.created_at < make_timestamptz(${year}::int, m.month::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
          ) as amount_at_close,
          m.month
        FROM deals d
        CROSS JOIN generate_series(1, 12) as m(month)
        WHERE d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')
          AND d.created_at < ${yearEnd}${dealFilter}
        GROUP BY d.client_id, m.month
      ),
      client_payments AS (
        SELECT p.client_id,
          COALESCE(SUM(p.amount) FILTER (
            WHERE p.paid_at < make_timestamptz(${year}::int, ms.month::int, 1, 0, 0, 0, ${TZ})
          ), 0) as paid_at_open,
          COALESCE(SUM(p.amount) FILTER (
            WHERE p.paid_at < make_timestamptz(${year}::int, ms.month::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
          ), 0) as paid_at_close,
          ms.month
        FROM payments p
        CROSS JOIN generate_series(1, 12) as ms(month)
        GROUP BY p.client_id, ms.month
      )
      SELECT cd.month,
        COALESCE(SUM(GREATEST(COALESCE(cd.amount_at_open, 0) - COALESCE(cp.paid_at_open, 0), 0)), 0)::text as opening_balance,
        COALESCE(SUM(GREATEST(COALESCE(cd.amount_at_close, 0) - COALESCE(cp.paid_at_close, 0), 0)), 0)::text as closing_balance
      FROM client_deals cd
      LEFT JOIN client_payments cp ON cp.client_id = cd.client_id AND cp.month = cd.month
      GROUP BY cd.month
      ORDER BY cd.month`,
    );
    const balanceMap = new Map(balanceRaw.map((r) => [r.month, { opening: Number(r.opening_balance), closing: Number(r.closing_balance) }]));

    // Shipped per month — deals that were actually shipped (from shipments table)
    const shippedByMonthRaw = await prisma.$queryRaw<
      { month: number; shipped: string }[]
    >(
      Prisma.sql`SELECT
        EXTRACT(MONTH FROM (s.shipped_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(d.amount), 0)::text as shipped
      FROM shipments s
      JOIN deals d ON d.id = s.deal_id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        AND s.shipped_at >= ${yearStart} AND s.shipped_at < ${yearEnd}
      GROUP BY EXTRACT(MONTH FROM (s.shipped_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
      ORDER BY month`,
    );
    const shippedMap = new Map(shippedByMonthRaw.map((r) => [r.month, Number(r.shipped)]));
    const revenueMap = new Map(revenueByMonthRaw.map((r) => [r.month, { revenue: Number(r.revenue), activeClients: Number(r.active_clients) }]));

    // Build trend for all months 1–currentMonth (always include zero-data months for correct charts)
    const currentMonth = year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
    const monthlyTrend: {
      month: number; revenue: number; collected: number; shipped: number;
      activeClients: number; openingBalance: number; closingBalance: number;
    }[] = [];
    for (let m = 1; m <= currentMonth; m++) {
      const rev = revenueMap.get(m);
      const collected = collectedMap.get(m) ?? 0;
      const shipped = shippedMap.get(m) ?? 0;
      monthlyTrend.push({
        month: m,
        revenue: rev?.revenue ?? 0,
        collected,
        shipped,
        activeClients: rev?.activeClients ?? 0,
        openingBalance: balanceMap.get(m)?.opening ?? 0,
        closingBalance: balanceMap.get(m)?.closing ?? 0,
      });
    }

    // ── 3. Top clients — use paid_amount for debt calculation ──
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
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
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
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL
        AND di.is_problem = false
        AND COALESCE(di.source_op_type, '') != 'EXCHANGE'
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

    // ── 5. Manager stats — collected from payments table (source of truth) ──
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
        COALESCE(mc.total_collected, 0)::text as collected,
        COUNT(DISTINCT d.client_id)::text as clients
      FROM deals d
      JOIN users u ON u.id = d.manager_id
      LEFT JOIN (
        SELECT d2.manager_id, SUM(p.amount) as total_collected
        FROM payments p
        JOIN deals d2 ON d2.id = p.deal_id
        WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
        GROUP BY d2.manager_id
      ) mc ON mc.manager_id = u.id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY u.id, u.full_name, mc.total_collected
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
      Prisma.sql`SELECT COALESCE(p.method, 'Не указан') as method,
        SUM(p.amount)::text as total,
        COUNT(*)::text as count
      FROM payments p ${paymentDealJoin}
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
      AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
      GROUP BY COALESCE(p.method, 'Не указан')
      ORDER BY SUM(p.amount) DESC`,
    );
    const paymentMethods = paymentMethodsRaw.map((r) => ({
      method: r.method,
      total: Number(r.total),
      count: Number(r.count),
    }));

    // ── 7. Debtors — use paid_amount from deals (reliable per-deal tracking) ──
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
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.created_at < ${yearEnd}${dealFilter}
      GROUP BY c.id, c.company_name
      HAVING SUM(GREATEST(d.amount - d.paid_amount, 0)) > 0
      ORDER BY SUM(GREATEST(d.amount - d.paid_amount, 0)) DESC
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
        EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(di.requested_qty * di.price), 0)::text as revenue
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      LEFT JOIN deal_items di ON di.deal_id = d.id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY c.id, c.company_name, EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
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

    const responseData = {
      overview,
      monthlyTrend,
      topClients,
      topProducts,
      managers,
      paymentMethods,
      debtors,
      clientActivity,
      ...(debtDebug ? { debtDebug } : {}),
    };

    if (!dealScope.managerId && isPastYear(year)) {
      saveSnapshot({ year, month: 0, type: 'overview-v5' }, responseData).catch(() => {});
    }

    res.json(responseData);
  }),
);

// ── Drilldown endpoint ──
router.get(
  '/drilldown',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const year = parseYear(req);
    const { yearStart, yearEnd } = getYearBounds(year);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);

    const type = req.query.type as string;
    // ACL: manager's own scope overrides query param
    const managerId = dealScope.managerId || (req.query.managerId as string | undefined);
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
        WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
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
        WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}${methodFilter}${dealFilter}
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
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);

    const month = parseInt(req.params.month as string, 10);
    if (isNaN(month) || month < 1 || month > 12) {
      res.status(400).json({ error: 'Invalid month' });
      return;
    }

    // Snapshot: admin-only, past months
    if (!dealScope.managerId && isPastMonth(year, month)) {
      const cached = await getSnapshot({ year, month, type: 'month-detail-v4' });
      if (cached) { res.json(cached); return; }
    }

    const { yearStart, yearEnd } = getYearBounds(year);

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
      WHERE EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) = ${month}
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false${dealFilter}
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
      WHERE EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) = ${month}
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL
        AND di.is_problem = false
        AND COALESCE(di.source_op_type, '') != 'EXCHANGE'
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
      WHERE EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) = ${month}
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY u.id, u.full_name
      ORDER BY SUM(d.amount) DESC`,
    );

    // Payments in this month (by paid_at — cashflow)
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
      WHERE EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) = ${month}
        AND p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}${dealFilter}
      ORDER BY p.amount DESC`,
    );

    // Debt snapshot at end of month — use per-client payment sums (client_id is reliable)
    const monthBalanceRaw = await prisma.$queryRaw<
      { opening_balance: string; closing_balance: string }[]
    >(
      Prisma.sql`WITH client_deals AS (
        SELECT d.client_id,
          SUM(d.amount) FILTER (
            WHERE d.created_at < make_timestamptz(${year}::int, ${month}::int, 1, 0, 0, 0, ${TZ})
          ) as amount_at_open,
          SUM(d.amount) FILTER (
            WHERE d.created_at < make_timestamptz(${year}::int, ${month}::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
          ) as amount_at_close
        FROM deals d
        WHERE d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')
          AND d.created_at < ${yearEnd}${dealFilter}
        GROUP BY d.client_id
      ),
      client_payments AS (
        SELECT p.client_id,
          COALESCE(SUM(p.amount) FILTER (
            WHERE p.paid_at < make_timestamptz(${year}::int, ${month}::int, 1, 0, 0, 0, ${TZ})
          ), 0) as paid_at_open,
          COALESCE(SUM(p.amount) FILTER (
            WHERE p.paid_at < make_timestamptz(${year}::int, ${month}::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
          ), 0) as paid_at_close
        FROM payments p
        GROUP BY p.client_id
      )
      SELECT
        COALESCE(SUM(GREATEST(COALESCE(cd.amount_at_open, 0) - COALESCE(cp.paid_at_open, 0), 0)), 0)::text as opening_balance,
        COALESCE(SUM(GREATEST(COALESCE(cd.amount_at_close, 0) - COALESCE(cp.paid_at_close, 0), 0)), 0)::text as closing_balance
      FROM client_deals cd
      LEFT JOIN client_payments cp ON cp.client_id = cd.client_id`,
    );

    const debtSnapshotDebtorsRaw = await prisma.$queryRaw<
      { id: string; company_name: string; total_amount: string; total_paid: string; debt: string }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        SUM(d.amount)::text as total_amount,
        COALESCE(SUM(d.paid_amount), 0)::text as total_paid,
        SUM(GREATEST(d.amount - d.paid_amount, 0))::text as debt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        AND d.created_at < make_timestamptz(${year}::int, ${month}::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
      GROUP BY c.id, c.company_name
      HAVING SUM(GREATEST(d.amount - d.paid_amount, 0)) > 0
      ORDER BY SUM(GREATEST(d.amount - d.paid_amount, 0)) DESC
      LIMIT 30`,
    );

    const responseData = {
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
      payments: paymentsRaw.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paidAt: p.paid_at,
        method: p.method,
        dealTitle: p.deal_title,
        companyName: p.company_name,
      })),
      debtSnapshot: {
        openingBalance: Number(monthBalanceRaw[0]?.opening_balance ?? 0),
        closingBalance: Number(monthBalanceRaw[0]?.closing_balance ?? 0),
        debtors: debtSnapshotDebtorsRaw.map((r) => ({
          id: r.id,
          companyName: r.company_name,
          totalAmount: Number(r.total_amount),
          totalPaid: Number(r.total_paid),
          debt: Number(r.debt),
        })),
      },
    };

    if (!dealScope.managerId && isPastMonth(year, month)) {
      saveSnapshot({ year, month, type: 'month-detail-v4' }, responseData).catch(() => {});
    }

    res.json(responseData);
  }),
);

// ── Extended analytics endpoint ──
router.get(
  '/extended',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);

    // Snapshot: admin-only, past years
    if (!dealScope.managerId && isPastYear(year)) {
      const cached = await getSnapshot({ year, month: 0, type: 'extended' });
      if (cached) { res.json(cached); return; }
    }

    const { yearStart, yearEnd } = getYearBounds(year);

    // 1. Retention (month-over-month)
    const retentionRaw = await prisma.$queryRaw<
      { month: number; total_clients: string; retained_clients: string }[]
    >(
      Prisma.sql`WITH monthly_clients AS (
        SELECT DISTINCT d.client_id, EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month
        FROM deals d
        WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
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
        WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
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
          EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
          d.client_id
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN products p ON p.id = di.product_id
        WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
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
        EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COUNT(d.id)::text as deals_count
      FROM deals d
      JOIN users u ON u.id = d.manager_id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY d.manager_id, u.full_name, EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
      ORDER BY u.full_name, month`,
    );
    const managerTrendRaw2 = managerTrendRaw.map((r) => ({
      managerId: r.manager_id,
      fullName: r.full_name,
      month: r.month,
      revenue: Number(r.revenue),
      dealsCount: Number(r.deals_count),
    }));

    // Fill missing months with zeros so every manager has a data point for every month
    const allManagerIds = [...new Set(managerTrendRaw2.map((r) => r.managerId))];
    const allMonths = [...new Set(managerTrendRaw2.map((r) => r.month))].sort((a, b) => a - b);
    const managerNameMap = new Map(managerTrendRaw2.map((r) => [r.managerId, r.fullName]));
    const existingKeys = new Set(managerTrendRaw2.map((r) => `${r.managerId}-${r.month}`));
    const managerTrend = [...managerTrendRaw2];
    for (const mid of allManagerIds) {
      for (const m of allMonths) {
        if (!existingKeys.has(`${mid}-${m}`)) {
          managerTrend.push({
            managerId: mid,
            fullName: managerNameMap.get(mid) || '',
            month: m,
            revenue: 0,
            dealsCount: 0,
          });
        }
      }
    }
    managerTrend.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.month - b.month);

    // 5. Cohort analysis
    const cohortRaw = await prisma.$queryRaw<
      { cohort_month: number; active_month: number; client_count: string; revenue_total: string }[]
    >(
      Prisma.sql`WITH first_deal AS (
        SELECT d.client_id, MIN(EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}))::int as cohort_month
        FROM deals d
        WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        GROUP BY d.client_id
      ),
      monthly_activity AS (
        SELECT d.client_id,
          EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as active_month,
          SUM(d.amount) as revenue
        FROM deals d
        WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        GROUP BY d.client_id, EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
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
        MAX(EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}))::int as last_deal_month
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
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
      Prisma.sql`SELECT EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COUNT(d.id)::text as deals_count,
        COALESCE(AVG(d.amount), 0)::text as avg_deal_size
      FROM deals d
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
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
        MAX(EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}))::int as last_active_month
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY c.id, c.company_name`,
    );

    // Get active months per client for segment calculation
    const activeMonthsRaw = await prisma.$queryRaw<
      { client_id: string; month: number }[]
    >(
      Prisma.sql`SELECT DISTINCT d.client_id, EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month
      FROM deals d
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd} AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}`,
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

    // Scale segment thresholds proportionally to elapsed months (fixes partial-year like early 2026)
    const segNow = new Date();
    const segTashkent = new Date(segNow.getTime() + 5 * 60 * 60 * 1000);
    const segCurrentYear = segTashkent.getUTCFullYear();
    const segCurrentMonth = segTashkent.getUTCMonth() + 1;
    const maxElapsedMonth = year < segCurrentYear ? 12 : Math.min(segCurrentMonth, 12);

    function computeSegment(dealsCount: number, totalRevenue: number, lastMonth: number, monthsCount: number): string {
      const scaledVipDeals = Math.max(2, Math.ceil(5 * maxElapsedMonth / 12));
      if (totalRevenue >= vipThreshold && dealsCount >= scaledVipDeals) return 'VIP';

      const regularThreshold = Math.max(2, Math.ceil(maxElapsedMonth / 3));
      if (monthsCount >= regularThreshold) return 'Regular';

      const newThreshold = Math.max(1, Math.ceil(maxElapsedMonth * 3 / 4));
      if (monthsCount <= 2 && lastMonth >= newThreshold) return 'New';

      const churnedThreshold = Math.max(1, Math.ceil(maxElapsedMonth / 2));
      if (monthsCount <= 2 && lastMonth <= churnedThreshold) return 'Churned';

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

    const responseData = {
      retention,
      concentration,
      productRecurring,
      managerTrend,
      cohort,
      debtRisk,
      seasonality,
      clientSegments,
      segmentSummary,
    };

    if (!dealScope.managerId && isPastYear(year)) {
      saveSnapshot({ year, month: 0, type: 'extended' }, responseData).catch(() => {});
    }

    res.json(responseData);
  }),
);

// ── Client-month purchases endpoint ──
router.get(
  '/client-month/:clientId/:month',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);
    const { yearStart, yearEnd } = getYearBounds(year);

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
        created_at: Date;
      }[]
    >(
      Prisma.sql`SELECT di.id, p.name as product_name, p.unit,
        COALESCE(di.requested_qty, 0)::text as qty, COALESCE(di.price, 0)::text as price,
        (COALESCE(di.requested_qty, 0) * COALESCE(di.price, 0))::text as total,
        d.title as deal_title, d.id as deal_id, d.created_at
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      WHERE d.client_id = ${clientId}
        AND EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) = ${month}
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
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
      createdAt: r.created_at,
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
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);
    const { yearStart, yearEnd } = getYearBounds(year);

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
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
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
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { paymentDealJoin } = buildAclFragments(dealScope);

    // Snapshot: admin-only, past years
    if (!dealScope.managerId && isPastYear(year)) {
      const cached = await getSnapshot({ year, month: 0, type: 'cashflow' });
      if (cached) { res.json(cached); return; }
    }

    const { yearStart, yearEnd } = getYearBounds(year);

    // Monthly collected (by payment date, not deal creation)
    const monthlyRaw = await prisma.$queryRaw<
      { month: number; collected: string; payments_count: string }[]
    >(
      Prisma.sql`SELECT
        EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COALESCE(SUM(p.amount), 0)::text as collected,
        COUNT(*)::text as payments_count
      FROM payments p ${paymentDealJoin}
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
      AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
      GROUP BY EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
      ORDER BY month`,
    );

    // Top clients by collected amount
    const topClientsRaw = await prisma.$queryRaw<
      { id: string; company_name: string; collected: string; payments_count: string }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        SUM(p.amount)::text as collected,
        COUNT(*)::text as payments_count
      FROM payments p ${paymentDealJoin}
      JOIN clients c ON c.id = p.client_id
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
      AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
      GROUP BY c.id, c.company_name
      ORDER BY SUM(p.amount) DESC
      LIMIT 20`,
    );

    // Totals
    const totalsRaw = await prisma.$queryRaw<
      { total_collected: string; total_payments: string }[]
    >(
      Prisma.sql`SELECT
        COALESCE(SUM(p.amount), 0)::text as total_collected,
        COUNT(*)::text as total_payments
      FROM payments p ${paymentDealJoin}
      WHERE p.paid_at >= ${yearStart} AND p.paid_at < ${yearEnd}
      AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')`,
    );

    const responseData = {
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
    };

    if (!dealScope.managerId && isPastYear(year)) {
      saveSnapshot({ year, month: 0, type: 'cashflow' }, responseData).catch(() => {});
    }

    res.json(responseData);
  }),
);

// ── Data Quality endpoint ──
router.get(
  '/data-quality',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);

    // Snapshot: admin-only, past years
    if (!dealScope.managerId && isPastYear(year)) {
      const cached = await getSnapshot({ year, month: 0, type: 'data-quality' });
      if (cached) { res.json(cached); return; }
    }

    const { yearStart, yearEnd } = getYearBounds(year);

    // 1. KPI totals
    const kpiRaw = await prisma.$queryRaw<
      { total_rows: string; total_qty: string }[]
    >(
      Prisma.sql`SELECT COUNT(*)::text as total_rows,
        COALESCE(SUM(di.requested_qty), 0)::text as total_qty
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE di.is_problem = true
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false${dealFilter}`,
    );

    // 2. By operation type
    const byOpTypeRaw = await prisma.$queryRaw<
      { op_type: string; count: string }[]
    >(
      Prisma.sql`SELECT COALESCE(di.source_op_type, 'НЕ УКАЗАН') as op_type,
        COUNT(*)::text as count
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE di.is_problem = true
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false${dealFilter}
      GROUP BY COALESCE(di.source_op_type, 'НЕ УКАЗАН')
      ORDER BY COUNT(*) DESC`,
    );

    // 3. Top products by problem qty
    const topProductsRaw = await prisma.$queryRaw<
      { id: string; name: string; unit: string; total_qty: string; problem_count: string }[]
    >(
      Prisma.sql`SELECT p.id, p.name, p.unit,
        COALESCE(SUM(di.requested_qty), 0)::text as total_qty,
        COUNT(*)::text as problem_count
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      WHERE di.is_problem = true
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false${dealFilter}
      GROUP BY p.id, p.name, p.unit
      ORDER BY SUM(di.requested_qty) DESC
      LIMIT 20`,
    );

    // 4. Top clients by problem rows
    const topClientsRaw = await prisma.$queryRaw<
      { id: string; company_name: string; problem_count: string; total_qty: string }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        COUNT(*)::text as problem_count,
        COALESCE(SUM(di.requested_qty), 0)::text as total_qty
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN clients c ON c.id = d.client_id
      WHERE di.is_problem = true
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false${dealFilter}
      GROUP BY c.id, c.company_name
      ORDER BY COUNT(*) DESC
      LIMIT 20`,
    );

    // 5. Problem rows detail
    const problemRowsRaw = await prisma.$queryRaw<
      {
        id: string; product_name: string; unit: string; qty: string;
        op_type: string; deal_id: string; deal_title: string; company_name: string;
        manager_name: string; created_at: Date;
      }[]
    >(
      Prisma.sql`SELECT di.id, p.name as product_name, p.unit,
        COALESCE(di.requested_qty, 0)::text as qty,
        COALESCE(di.source_op_type, 'НЕ УКАЗАН') as op_type,
        d.id as deal_id, d.title as deal_title, c.company_name, u.full_name as manager_name,
        d.created_at
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      JOIN clients c ON c.id = d.client_id
      JOIN users u ON u.id = d.manager_id
      WHERE di.is_problem = true
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false${dealFilter}
      ORDER BY di.requested_qty DESC
      LIMIT 500`,
    );

    const responseData = {
      totalProblemRows: Number(kpiRaw[0]?.total_rows ?? 0),
      totalQtyInProblem: Math.round(Number(kpiRaw[0]?.total_qty ?? 0) * 100) / 100,
      problemByOpType: byOpTypeRaw.map((r) => ({
        opType: r.op_type,
        count: Number(r.count),
      })),
      topProducts: topProductsRaw.map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        totalQty: Math.round(Number(r.total_qty) * 100) / 100,
        problemCount: Number(r.problem_count),
      })),
      topClients: topClientsRaw.map((r) => ({
        id: r.id,
        companyName: r.company_name,
        problemCount: Number(r.problem_count),
        totalQty: Math.round(Number(r.total_qty) * 100) / 100,
      })),
      problemRows: problemRowsRaw.map((r) => ({
        id: r.id,
        productName: r.product_name,
        unit: r.unit,
        qty: Math.round(Number(r.qty) * 100) / 100,
        opType: r.op_type,
        dealId: r.deal_id,
        dealTitle: r.deal_title,
        companyName: r.company_name,
        managerName: r.manager_name,
        createdAt: r.created_at,
      })),
    };

    if (!dealScope.managerId && isPastYear(year)) {
      saveSnapshot({ year, month: 0, type: 'data-quality' }, responseData).catch(() => {});
    }

    res.json(responseData);
  }),
);

// ── Exchange analytics endpoint ──
router.get(
  '/exchange',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);

    // Snapshot: admin-only, past years
    if (!dealScope.managerId && isPastYear(year)) {
      const cached = await getSnapshot({ year, month: 0, type: 'exchange' });
      if (cached) { res.json(cached); return; }
    }

    const { yearStart, yearEnd } = getYearBounds(year);

    // 1. KPI totals
    const kpiRaw = await prisma.$queryRaw<
      { total_exchanges: string; total_qty: string; unique_clients: string; unique_products: string }[]
    >(
      Prisma.sql`SELECT COUNT(*)::text as total_exchanges,
        COALESCE(SUM(di.requested_qty), 0)::text as total_qty,
        COUNT(DISTINCT d.client_id)::text as unique_clients,
        COUNT(DISTINCT di.product_id)::text as unique_products
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE di.source_op_type = 'EXCHANGE'
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}`,
    );

    // 2. By month
    const byMonthRaw = await prisma.$queryRaw<
      { month: number; count: string; total_qty: string }[]
    >(
      Prisma.sql`SELECT EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COUNT(*)::text as count,
        COALESCE(SUM(di.requested_qty), 0)::text as total_qty
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE di.source_op_type = 'EXCHANGE'
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
      ORDER BY month`,
    );

    // 3. Top products
    const productsRaw = await prisma.$queryRaw<
      { id: string; name: string; unit: string; total_qty: string; unique_clients: string }[]
    >(
      Prisma.sql`SELECT p.id, p.name, p.unit,
        COALESCE(SUM(di.requested_qty), 0)::text as total_qty,
        COUNT(DISTINCT d.client_id)::text as unique_clients
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      WHERE di.source_op_type = 'EXCHANGE'
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY p.id, p.name, p.unit
      ORDER BY SUM(di.requested_qty) DESC
      LIMIT 20`,
    );

    // 4. Top clients
    const clientsRaw = await prisma.$queryRaw<
      { id: string; company_name: string; exchange_count: string; total_qty: string }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        COUNT(*)::text as exchange_count,
        COALESCE(SUM(di.requested_qty), 0)::text as total_qty
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN clients c ON c.id = d.client_id
      WHERE di.source_op_type = 'EXCHANGE'
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY c.id, c.company_name
      ORDER BY COUNT(*) DESC
      LIMIT 20`,
    );

    const responseData = {
      totalExchanges: Number(kpiRaw[0]?.total_exchanges ?? 0),
      totalQty: Math.round(Number(kpiRaw[0]?.total_qty ?? 0) * 100) / 100,
      uniqueClients: Number(kpiRaw[0]?.unique_clients ?? 0),
      uniqueProducts: Number(kpiRaw[0]?.unique_products ?? 0),
      byMonth: byMonthRaw.map((r) => ({
        month: r.month,
        count: Number(r.count),
        totalQty: Math.round(Number(r.total_qty) * 100) / 100,
      })),
      products: productsRaw.map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        totalQty: Math.round(Number(r.total_qty) * 100) / 100,
        uniqueClients: Number(r.unique_clients),
      })),
      clients: clientsRaw.map((r) => ({
        id: r.id,
        companyName: r.company_name,
        exchangeCount: Number(r.exchange_count),
        totalQty: Math.round(Number(r.total_qty) * 100) / 100,
      })),
    };

    if (!dealScope.managerId && isPastYear(year)) {
      saveSnapshot({ year, month: 0, type: 'exchange' }, responseData).catch(() => {});
    }

    res.json(responseData);
  }),
);

// ── Prepayments analytics endpoint ──
router.get(
  '/prepayments',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);

    // Snapshot: admin-only, past years
    if (!dealScope.managerId && isPastYear(year)) {
      const cached = await getSnapshot({ year, month: 0, type: 'prepayments' });
      if (cached) { res.json(cached); return; }
    }

    const { yearStart, yearEnd } = getYearBounds(year);

    // 1. KPI totals
    const kpiRaw = await prisma.$queryRaw<
      { total_rows: string; total_amount: string }[]
    >(
      Prisma.sql`SELECT COUNT(*)::text as total_rows,
        COALESCE(SUM(di.requested_qty * di.price), 0)::text as total_amount
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE di.source_op_type = 'PP'
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL`,
    );

    // 2. By month
    const byMonthRaw = await prisma.$queryRaw<
      { month: number; count: string; amount: string }[]
    >(
      Prisma.sql`SELECT EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COUNT(*)::text as count,
        COALESCE(SUM(di.requested_qty * di.price), 0)::text as amount
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE di.source_op_type = 'PP'
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL
      GROUP BY EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
      ORDER BY month`,
    );

    // 3. Top clients
    const topClientsRaw = await prisma.$queryRaw<
      { id: string; company_name: string; pp_count: string; total_amount: string }[]
    >(
      Prisma.sql`SELECT c.id, c.company_name,
        COUNT(*)::text as pp_count,
        COALESCE(SUM(di.requested_qty * di.price), 0)::text as total_amount
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN clients c ON c.id = d.client_id
      WHERE di.source_op_type = 'PP'
        AND d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        AND di.price IS NOT NULL AND di.requested_qty IS NOT NULL
      GROUP BY c.id, c.company_name
      ORDER BY SUM(di.requested_qty * di.price) DESC
      LIMIT 20`,
    );

    const responseData = {
      totalRows: Number(kpiRaw[0]?.total_rows ?? 0),
      totalAmount: Number(kpiRaw[0]?.total_amount ?? 0),
      byMonth: byMonthRaw.map((r) => ({
        month: r.month,
        count: Number(r.count),
        amount: Number(r.amount),
      })),
      topClients: topClientsRaw.map((r) => ({
        id: r.id,
        companyName: r.company_name,
        ppCount: Number(r.pp_count),
        totalAmount: Number(r.total_amount),
      })),
    };

    if (!dealScope.managerId && isPastYear(year)) {
      saveSnapshot({ year, month: 0, type: 'prepayments' }, responseData).catch(() => {});
    }

    res.json(responseData);
  }),
);

// ── CSV export: debt breakdown by client ──
router.get(
  '/export/debt-breakdown',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);

    const rows = await prisma.$queryRaw<
      {
        company_name: string;
        deals_count: string;
        total_amount: string;
        total_paid: string;
        debt: string;
        overpayment: string;
      }[]
    >(
      Prisma.sql`SELECT c.company_name,
        COUNT(d.id)::text as deals_count,
        COALESCE(SUM(d.amount), 0)::text as total_amount,
        COALESCE(SUM(d.paid_amount), 0)::text as total_paid,
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as debt,
        COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as overpayment
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
      GROUP BY c.id, c.company_name
      HAVING SUM(GREATEST(d.amount - d.paid_amount, 0)) > 0
        OR SUM(GREATEST(d.paid_amount - d.amount, 0)) > 0
      ORDER BY SUM(GREATEST(d.amount - d.paid_amount, 0)) DESC`,
    );

    const BOM = '\uFEFF';
    const header = 'Клиент,Сделок,Сумма сделок,Оплачено,Долг,Переплата';
    const csvRows = rows.map((r) => {
      const name = r.company_name.replace(/"/g, '""');
      return `"${name}",${r.deals_count},${r.total_amount},${r.total_paid},${r.debt},${r.overpayment}`;
    });

    const csv = BOM + header + '\n' + csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="debt-breakdown-${year}.csv"`);
    res.send(csv);
  }),
);

// ── Cohort drill-down: clients who first bought in cohortMonth and were active in activeMonth ──
router.get(
  '/cohort-clients/:cohortMonth/:activeMonth',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const year = parseYear(req);
    const dealScope = extractDealScope(req);
    const { dealFilter } = buildAclFragments(dealScope);
    const { yearStart, yearEnd } = getYearBounds(year);
    const cohortMonth = Number(req.params.cohortMonth);
    const activeMonth = Number(req.params.activeMonth);

    const rows = await prisma.$queryRaw<
      { client_id: string; company_name: string; revenue: string; deals_count: string }[]
    >(
      Prisma.sql`WITH first_deal AS (
        SELECT d.client_id,
          MIN(EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}))::int as cohort_month
        FROM deals d
        WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
          AND d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        GROUP BY d.client_id
      )
      SELECT c.id as client_id, c.company_name,
        COALESCE(SUM(d.amount), 0)::text as revenue,
        COUNT(d.id)::text as deals_count
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      JOIN first_deal f ON f.client_id = d.client_id AND f.cohort_month = ${cohortMonth}
      WHERE d.created_at >= ${yearStart} AND d.created_at < ${yearEnd}
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')${dealFilter}
        AND EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int = ${activeMonth}
      GROUP BY c.id, c.company_name
      ORDER BY SUM(d.amount) DESC`,
    );

    res.json({
      cohortMonth,
      activeMonth,
      clients: rows.map((r) => ({
        clientId: r.client_id,
        companyName: r.company_name,
        revenue: Number(r.revenue),
        dealsCount: Number(r.deals_count),
      })),
    });
  }),
);

export { router as historyRoutes };
