import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_DEALS_CLOSED_REVENUE_FILTER,
  SQL_DEALS_SHIPPED_CLOSED_FILTER,
  SQL_EFFECTIVE_ITEM_DATE_TASHKENT,
  SQL_EFFECTIVE_ITEM_TS,
  SQL_LINE_REVENUE_DI,
} from '../../lib/analytics';
import { sqlMovementIsSale } from '../../lib/inventoryAnalytics';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';
import { authorize } from '../../middleware/authorize';

const router = Router();

router.use(authenticate);

// Tashkent = UTC+5
const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;

/** Calendar day in Asia/Tashkent (YYYY-MM-DD) for a UTC instant. */
function utcInstantToTashkentDayKey(utc: Date): string {
  const t = new Date(utc.getTime() + TASHKENT_OFFSET);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** All Tashkent calendar days touched by [start, end) (end exclusive). */
function enumerateTashkentDaysInRange(start: Date, end: Date): string[] {
  const set = new Set<string>();
  for (let t = start.getTime(); t < end.getTime(); t += 3600000) {
    set.add(utcInstantToTashkentDayKey(new Date(t)));
  }
  return [...set].sort();
}

function getCallActivityRange(range: string): { start: Date; end: Date } {
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
  const y = nowTashkent.getUTCFullYear();
  const m = nowTashkent.getUTCMonth();
  const d = nowTashkent.getUTCDate();
  const startOfTodayUtc = new Date(Date.UTC(y, m, d) - TASHKENT_OFFSET);
  const endExclusive = new Date(startOfTodayUtc.getTime() + 86400000);

  switch (range) {
    case 'week':
      return { start: new Date(endExclusive.getTime() - 7 * 86400000), end: endExclusive };
    case 'month':
      return { start: new Date(Date.UTC(y, m, 1) - TASHKENT_OFFSET), end: endExclusive };
    case 'today':
    default:
      return { start: startOfTodayUtc, end: endExclusive };
  }
}

router.get(
  '/call-activity',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role as Role;
    const isManager = role === 'MANAGER';

    const rangeParam = (req.query.range as string) || 'today';
    const range = rangeParam === 'week' || rangeParam === 'month' ? rangeParam : 'today';
    const managerIdFromQuery =
      typeof req.query.managerId === 'string' && req.query.managerId.length > 0 ? req.query.managerId : undefined;
    /** Managers always see all authors; filter by manager is admin-only. */
    const managerId = isManager ? undefined : managerIdFromQuery;
    const clientSearch =
      typeof req.query.clientSearch === 'string' ? req.query.clientSearch.trim() : '';

    const { start, end } = getCallActivityRange(range);

    const where: Prisma.ClientNoteWhereInput = {
      deletedAt: null,
      createdAt: { gte: start, lt: end },
      ...(managerId ? { userId: managerId } : {}),
      ...(clientSearch.length > 0
        ? { client: { companyName: { contains: clientSearch, mode: 'insensitive' } } }
        : {}),
    };

    if (isManager) {
      const whereSelf: Prisma.ClientNoteWhereInput = {
        ...where,
        userId: req.user!.userId,
      };
      const feedRows = await prisma.clientNote.findMany({
        where: whereSelf,
        select: {
          id: true,
          userId: true,
          clientId: true,
          content: true,
          createdAt: true,
          user: { select: { fullName: true } },
          client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 120,
      });

      const feed = feedRows.map((n) => ({
        id: n.id,
        userId: n.userId,
        managerName: n.user.fullName,
        clientId: n.clientId,
        companyName: n.client.companyName,
        preview: n.content.length > 160 ? `${n.content.slice(0, 160)}…` : n.content,
        createdAt: n.createdAt.toISOString(),
      }));

      res.json({
        range: { key: range, start: start.toISOString(), end: end.toISOString() },
        summary: [],
        lineChart: [],
        barChart: [],
        feed,
      });
      return;
    }

    const [aggRows, feedRows] = await Promise.all([
      prisma.clientNote.findMany({
        where,
        select: {
          userId: true,
          createdAt: true,
          user: { select: { fullName: true } },
        },
      }),
      prisma.clientNote.findMany({
        where,
        select: {
          id: true,
          userId: true,
          clientId: true,
          content: true,
          createdAt: true,
          user: { select: { fullName: true } },
          client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 120,
      }),
    ]);

    type SummaryRow = { userId: string; fullName: string; contactCount: number; lastActivityAt: string };
    const summaryMap = new Map<string, { fullName: string; contactCount: number; lastActivityAt: Date }>();

    for (const row of aggRows) {
      const uid = row.userId;
      const name = row.user.fullName;
      const existing = summaryMap.get(uid);
      if (!existing) {
        summaryMap.set(uid, { fullName: name, contactCount: 1, lastActivityAt: row.createdAt });
      } else {
        existing.contactCount += 1;
        if (row.createdAt > existing.lastActivityAt) existing.lastActivityAt = row.createdAt;
      }
    }

    const summary: SummaryRow[] = [...summaryMap.entries()]
      .map(([userId, v]) => ({
        userId,
        fullName: v.fullName,
        contactCount: v.contactCount,
        lastActivityAt: v.lastActivityAt.toISOString(),
      }))
      .sort((a, b) => b.contactCount - a.contactCount);

    const byManagerDay = new Map<string, Map<string, number>>();
    for (const row of aggRows) {
      const day = utcInstantToTashkentDayKey(row.createdAt);
      if (!byManagerDay.has(row.userId)) byManagerDay.set(row.userId, new Map());
      const dm = byManagerDay.get(row.userId)!;
      dm.set(day, (dm.get(day) ?? 0) + 1);
    }

    const dayList = enumerateTashkentDaysInRange(start, end);
    const lineChart: { day: string; manager: string; userId: string; count: number }[] = [];
    for (const [uid, dm] of byManagerDay) {
      const name = summaryMap.get(uid)?.fullName ?? '—';
      for (const day of dayList) {
        lineChart.push({ day, manager: name, userId: uid, count: dm.get(day) ?? 0 });
      }
    }

    const barChart = summary.map((s) => ({
      manager: s.fullName,
      userId: s.userId,
      total: s.contactCount,
    }));

    const feed = feedRows.map((n) => ({
      id: n.id,
      userId: n.userId,
      managerName: n.user.fullName,
      clientId: n.clientId,
      companyName: n.client.companyName,
      preview: n.content.length > 160 ? `${n.content.slice(0, 160)}…` : n.content,
      createdAt: n.createdAt.toISOString(),
    }));

    res.json({
      range: { key: range, start: start.toISOString(), end: end.toISOString() },
      summary,
      lineChart,
      barChart,
      feed,
    });
  }),
);

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

    const revenueTotalOperational = () =>
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
               AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
               AND d.manager_id = ${dealScope.managerId}`,
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
               AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}`,
          );

    const revenueTotalShipped = () =>
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_SHIPPED_CLOSED_FILTER}
               AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
               AND d.manager_id = ${dealScope.managerId}`,
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_SHIPPED_CLOSED_FILTER}
               AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}`,
          );

    /** Avg line revenue per deal among deals with ≥1 line in period (operational). */
    const avgDealOperational = () =>
      dealScope.managerId
        ? prisma.$queryRaw<{ avg_amount: string }[]>(
            Prisma.sql`SELECT COALESCE(AVG(sub.rev), 0)::text as avg_amount
             FROM (
               SELECT SUM(${SQL_LINE_REVENUE_DI})::numeric as rev
               FROM deals d
               INNER JOIN deal_items di ON di.deal_id = d.id
               WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
                 AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
                 AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
                 AND d.manager_id = ${dealScope.managerId}
               GROUP BY d.id
             ) sub`,
          )
        : prisma.$queryRaw<{ avg_amount: string }[]>(
            Prisma.sql`SELECT COALESCE(AVG(sub.rev), 0)::text as avg_amount
             FROM (
               SELECT SUM(${SQL_LINE_REVENUE_DI})::numeric as rev
               FROM deals d
               INNER JOIN deal_items di ON di.deal_id = d.id
               WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
                 AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
                 AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
               GROUP BY d.id
             ) sub`,
          );

    const revenueByDayOperational = () =>
      dealScope.managerId
        ? prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT} as day,
                              SUM(${SQL_LINE_REVENUE_DI})::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
               AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT}
             ORDER BY day ASC`,
          )
        : prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT} as day,
                              SUM(${SQL_LINE_REVENUE_DI})::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
               AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
             GROUP BY ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT}
             ORDER BY day ASC`,
          );

    const revenueByDayShipped = () =>
      dealScope.managerId
        ? prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT} as day,
                              SUM(${SQL_LINE_REVENUE_DI})::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_SHIPPED_CLOSED_FILTER}
               AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT}
             ORDER BY day ASC`,
          )
        : prisma.$queryRaw<{ day: Date; total: string }[]>(
            Prisma.sql`SELECT ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT} as day,
                              SUM(${SQL_LINE_REVENUE_DI})::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE ${SQL_DEALS_SHIPPED_CLOSED_FILTER}
               AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
               AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
             GROUP BY ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT}
             ORDER BY day ASC`,
          );

    const topClientsByOperationalRevenue = () =>
      dealScope.managerId
        ? prisma.$queryRaw<{
            client_id: string;
            company_name: string;
            is_svip: boolean;
            operational_revenue: string;
            shipped_revenue: string;
          }[]>(
            Prisma.sql`SELECT c.id as client_id, c.company_name, c.is_svip as is_svip,
                 COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as operational_revenue,
                 COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as shipped_revenue
               FROM deal_items di
               JOIN deals d ON d.id = di.deal_id
               JOIN clients c ON c.id = d.client_id
               WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
                 AND d.manager_id = ${dealScope.managerId}
                 AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
                 AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
               GROUP BY c.id, c.company_name, c.is_svip
               ORDER BY SUM(${SQL_LINE_REVENUE_DI}) DESC NULLS LAST
               LIMIT 5`,
          )
        : prisma.$queryRaw<{
            client_id: string;
            company_name: string;
            is_svip: boolean;
            operational_revenue: string;
            shipped_revenue: string;
          }[]>(
            Prisma.sql`SELECT c.id as client_id, c.company_name, c.is_svip as is_svip,
                 COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as operational_revenue,
                 COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as shipped_revenue
               FROM deal_items di
               JOIN deals d ON d.id = di.deal_id
               JOIN clients c ON c.id = d.client_id
               WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
                 AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
                 AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
               GROUP BY c.id, c.company_name, c.is_svip
               ORDER BY SUM(${SQL_LINE_REVENUE_DI}) DESC NULLS LAST
               LIMIT 5`,
          );

    // ──── SALES ────
    const [
      salesRevenueOperationalRaw,
      salesRevenueShippedRaw,
      salesAvgAgg,
      completedCount,
      totalDealsCount,
      canceledCount,
      revenueByDayOperationalRaw,
      revenueByDayShippedRaw,
      dealsByStatus,
      topClientsRaw,
      topProductsRaw,
    ] = await Promise.all([
      revenueTotalOperational(),
      revenueTotalShipped(),
      avgDealOperational(),
      // COMPLETED + CLOSED count (for conversion)
      prisma.deal.count({
        where: { ...dealScope, status: 'CLOSED', isArchived: false, createdAt: { gte: start, lt: end } },
      }),
      // Total deals created in period (all statuses)
      prisma.deal.count({
        where: { ...dealScope, isArchived: false, createdAt: { gte: start, lt: end } },
      }),
      // CANCELED count
      prisma.deal.count({
        where: { ...dealScope, status: 'CANCELED', isArchived: false, createdAt: { gte: start, lt: end } },
      }),
      revenueByDayOperational(),
      revenueByDayShipped(),
      // Deals by status
      prisma.deal.groupBy({
        by: ['status'],
        where: { ...dealScope, isArchived: false, createdAt: { gte: start, lt: end } },
        _count: true,
      }),
      topClientsByOperationalRevenue(),
      // Top 5 products by quantity sold (CLOSED deals, deal_items only)
      prisma.$queryRaw<{ product_id: string; name: string; total_quantity: string }[]>(
        Prisma.sql`SELECT p.id as product_id, p.name, COALESCE(SUM(di.requested_qty), 0)::text as total_quantity
         FROM deal_items di
         JOIN deals d ON d.id = di.deal_id
         JOIN products p ON p.id = di.product_id
         WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
           AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
           AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
           AND di.requested_qty IS NOT NULL
         GROUP BY p.id, p.name
         ORDER BY SUM(di.requested_qty) DESC
         LIMIT 5`,
      ),
    ]);

    const dayKey = (r: { day: Date; total: string }) =>
      r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);

    const opByDay = new Map(revenueByDayOperationalRaw.map((r) => [dayKey(r), Number(r.total)]));
    const shByDay = new Map(revenueByDayShippedRaw.map((r) => [dayKey(r), Number(r.total)]));
    const allDayKeys = new Set([...opByDay.keys(), ...shByDay.keys()]);
    const revenueByDay = [...allDayKeys]
      .sort()
      .map((day) => ({
        day,
        /** Operational line revenue (default / primary). */
        total: opByDay.get(day) ?? 0,
        /** SHIPPED/CLOSED line revenue (same date logic). */
        shippedTotal: shByDay.get(day) ?? 0,
      }));

    const operationalTotal = salesRevenueOperationalRaw[0] ? Number(salesRevenueOperationalRaw[0].total) : 0;
    const shippedTotal = salesRevenueShippedRaw[0] ? Number(salesRevenueShippedRaw[0].total) : 0;

    const sales = {
      /** Operational revenue (active deals, line totals, effective item date). */
      totalRevenue: operationalTotal,
      /** SHIPPED/CLOSED revenue (same line + date rules). Former default for totalRevenue. */
      shippedRevenue: shippedTotal,
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
        isSvip: !!c.is_svip,
        totalRevenue: Number(c.operational_revenue),
        shippedRevenue: Number(c.shipped_revenue),
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
      }) as unknown as Promise<any[]>,
      prisma.deal.findMany({
        where: {
          ...dealScope,
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          dueDate: { lt: new Date() },
          isArchived: false,
        },
        include: { client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } } },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      dealScope.managerId
        ? prisma.$queryRaw<{ client_id: string; company_name: string; is_svip: boolean; total_debt: string }[]>(
            Prisma.sql`SELECT c.id as client_id, c.company_name, c.is_svip as is_svip, SUM(d.amount - d.paid_amount)::text as total_debt
             FROM deals d
             JOIN clients c ON c.id = d.client_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
               AND d.manager_id = ${dealScope.managerId}
             GROUP BY c.id, c.company_name, c.is_svip
             HAVING SUM(d.amount - d.paid_amount) > 0
             ORDER BY SUM(d.amount - d.paid_amount) DESC
             LIMIT 10`
          )
        : prisma.$queryRaw<{ client_id: string; company_name: string; is_svip: boolean; total_debt: string }[]>(
            Prisma.sql`SELECT c.id as client_id, c.company_name, c.is_svip as is_svip, SUM(d.amount - d.paid_amount)::text as total_debt
             FROM deals d
             JOIN clients c ON c.id = d.client_id
             WHERE d.status NOT IN ('CANCELED', 'REJECTED')
               AND d.is_archived = false
             GROUP BY c.id, c.company_name, c.is_svip
             HAVING SUM(d.amount - d.paid_amount) > 0
             ORDER BY SUM(d.amount - d.paid_amount) DESC
             LIMIT 10`
          ),
      prisma.deal.aggregate({
        where: { ...dealScope, status: 'CLOSED', isArchived: false, createdAt: { gte: start, lt: end } },
        _sum: { paidAmount: true },
      }),
      // Paper turnover (from deal items line_total)
      dealScope.managerId
        ? prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status = 'CLOSED' AND d.is_archived = false
               AND d.created_at >= ${start} AND d.created_at < ${end}
               AND d.manager_id = ${dealScope.managerId}`
          )
        : prisma.$queryRaw<{ total: string }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
             FROM deal_items di
             JOIN deals d ON d.id = di.deal_id
             WHERE d.status = 'CLOSED' AND d.is_archived = false
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
        clientId: d.clientId,
        clientName: d.client.companyName,
        clientIsSvip: !!d.client?.isSvip,
        debt: Number(d.amount) - Number(d.paidAmount),
        dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
      })),
      topDebtors: topDebtorsRaw.map((d) => ({
        clientId: d.client_id,
        companyName: d.company_name,
        isSvip: !!d.is_svip,
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
         LEFT JOIN inventory_movements m ON m.product_id = p.id AND ${sqlMovementIsSale('m')}
         WHERE p.is_active = true AND p.stock > 0
         GROUP BY p.id, p.name, p.sku, p.stock
         HAVING MAX(m.created_at) IS NULL OR MAX(m.created_at) < NOW() - INTERVAL '30 days'
         ORDER BY p.stock DESC`
      ),
      prisma.$queryRaw<{ product_id: string; name: string; total_sold: string }[]>(
        Prisma.sql`SELECT p.id as product_id, p.name, SUM(m.quantity)::text as total_sold
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         WHERE ${sqlMovementIsSale('m')}
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
           COUNT(*) FILTER (WHERE d.status = 'CLOSED')::text as completed_count,
           COALESCE(SUM(di_rev.rev) FILTER (WHERE d.status = 'CLOSED'), 0)::text as total_revenue,
           COALESCE(AVG(di_rev.rev) FILTER (WHERE d.status = 'CLOSED'), 0)::text as avg_deal_amount,
           COUNT(*)::text as total_deals
         FROM deals d
         JOIN users u ON u.id = d.manager_id
         LEFT JOIN (SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0)) as rev FROM deal_items GROUP BY deal_id) di_rev ON di_rev.deal_id = d.id
         WHERE d.is_archived = false
           AND d.created_at >= ${start} AND d.created_at < ${end}
         GROUP BY d.manager_id, u.full_name
         ORDER BY SUM(di_rev.rev) FILTER (WHERE d.status = 'CLOSED') DESC NULLS LAST`
      ),
      prisma.$queryRaw<{ manager_id: string; avg_days: string }[]>(
        Prisma.sql`SELECT
           d.manager_id,
           AVG(EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) / 86400)::text as avg_days
         FROM deals d
         WHERE d.status = 'CLOSED' AND d.is_archived = false
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
         WHERE d.status = 'CLOSED'
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
