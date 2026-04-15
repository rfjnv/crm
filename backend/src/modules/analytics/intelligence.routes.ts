import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_LINE_REVENUE_DI,
  SQL_ANALYTICS_TZ,
} from '../../lib/analytics';
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

// ──── Segmentation logic ────

interface ClientRow {
  id: string;
  company_name: string;
  is_svip: boolean;
  completed_deals: string;
  ltv: string;
  avg_deal: string;
  last_deal_date: Date | null;
  current_debt: string;
}

function computeSegment(row: ClientRow, ltvThreshold: number): string {
  const completed = Number(row.completed_deals);
  const ltv = Number(row.ltv);
  const lastDeal = row.last_deal_date;
  const debt = Number(row.current_debt);
  const now = new Date();
  const daysSince = lastDeal ? (now.getTime() - new Date(lastDeal).getTime()) / 86400000 : Infinity;

  if (ltv >= ltvThreshold && completed >= 3) return 'VIP';
  if (completed >= 2) return 'Regular';
  if (completed >= 1 && daysSince <= 90) return 'New';
  if (completed >= 1 && daysSince > 90 && debt > 0) return 'At-Risk';
  if (daysSince > 180 || completed === 0) return 'Churned';
  return 'New';
}

function computeRiskScore(row: ClientRow): number {
  const completed = Number(row.completed_deals);
  const ltv = Number(row.ltv);
  const debt = Number(row.current_debt);
  const lastDeal = row.last_deal_date;
  const daysSince = lastDeal ? (new Date().getTime() - new Date(lastDeal).getTime()) / 86400000 : Infinity;

  let score = 0;
  // Debt ratio: 0-50 points
  if (ltv > 0) {
    score += Math.min(50, Math.round((debt / ltv) * 50));
  }
  // Inactivity: 0-25 points
  if (daysSince > 180) score += 25;
  else if (daysSince > 90) score += 10;
  // No completed deals: 25 points
  if (completed === 0) score += 25;

  return Math.min(100, score);
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

    // ════════════════════════════════════
    // ──── CLIENT INTELLIGENCE ────
    // ════════════════════════════════════

    const clientRows = dealScope.managerId
      ? await prisma.$queryRaw<ClientRow[]>(
          Prisma.sql`SELECT c.id, c.company_name, c.is_svip as is_svip,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'CLOSED')::text as completed_deals,
            COALESCE(SUM(di_rev.rev) FILTER (WHERE d.status = 'CLOSED'), 0)::text as ltv,
            COALESCE(AVG(di_rev.rev) FILTER (WHERE d.status = 'CLOSED'), 0)::text as avg_deal,
            MAX(d.created_at) FILTER (WHERE d.status = 'CLOSED') as last_deal_date,
            COALESCE(SUM(d.amount - d.paid_amount) FILTER (WHERE d.payment_status IN ('UNPAID','PARTIAL') AND d.status NOT IN ('CANCELED','REJECTED')), 0)::text as current_debt
          FROM clients c
          LEFT JOIN deals d ON d.client_id = c.id AND d.is_archived = false
          LEFT JOIN (
            SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0))::numeric as rev
            FROM deal_items GROUP BY deal_id
          ) di_rev ON di_rev.deal_id = d.id
          WHERE c.is_archived = false AND (d.manager_id = ${dealScope.managerId} OR d.id IS NULL)
          GROUP BY c.id, c.company_name, c.is_svip`,
        )
      : await prisma.$queryRaw<ClientRow[]>(
          Prisma.sql`SELECT c.id, c.company_name, c.is_svip as is_svip,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'CLOSED')::text as completed_deals,
            COALESCE(SUM(di_rev.rev) FILTER (WHERE d.status = 'CLOSED'), 0)::text as ltv,
            COALESCE(AVG(di_rev.rev) FILTER (WHERE d.status = 'CLOSED'), 0)::text as avg_deal,
            MAX(d.created_at) FILTER (WHERE d.status = 'CLOSED') as last_deal_date,
            COALESCE(SUM(d.amount - d.paid_amount) FILTER (WHERE d.payment_status IN ('UNPAID','PARTIAL') AND d.status NOT IN ('CANCELED','REJECTED')), 0)::text as current_debt
          FROM clients c
          LEFT JOIN deals d ON d.client_id = c.id AND d.is_archived = false
          LEFT JOIN (
            SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0))::numeric as rev
            FROM deal_items GROUP BY deal_id
          ) di_rev ON di_rev.deal_id = d.id
          WHERE c.is_archived = false
          GROUP BY c.id, c.company_name, c.is_svip`,
        );

    // Compute LTV threshold (top 10%)
    const ltvValues = clientRows.map((r) => Number(r.ltv)).filter((v) => v > 0).sort((a, b) => b - a);
    const ltvThreshold = ltvValues.length > 0 ? ltvValues[Math.floor(ltvValues.length * 0.1)] || 0 : 0;

    // Segment each client
    const segmented = clientRows.map((r) => ({
      ...r,
      segment: computeSegment(r, ltvThreshold),
      riskScore: computeRiskScore(r),
    }));

    const totalClients = segmented.length;
    const repeatClients = segmented.filter((r) => Number(r.completed_deals) >= 2).length;
    const repeatRate = totalClients > 0 ? repeatClients / totalClients : 0;

    // Segment counts
    const segmentCounts: Record<string, number> = {};
    for (const r of segmented) {
      segmentCounts[r.segment] = (segmentCounts[r.segment] || 0) + 1;
    }
    const segments = Object.entries(segmentCounts).map(([segment, count]) => ({ segment, count }));

    // Top 20 by LTV
    const topByLTV = [...segmented]
      .sort((a, b) => Number(b.ltv) - Number(a.ltv))
      .slice(0, 20)
      .map((r) => ({
        clientId: r.id,
        companyName: r.company_name,
        isSvip: !!r.is_svip,
        ltv: Number(r.ltv),
        dealsCount: Number(r.completed_deals),
        avgDealAmount: Number(r.avg_deal),
        riskScore: r.riskScore,
        lastDealDate: r.last_deal_date ? new Date(r.last_deal_date).toISOString().slice(0, 10) : '',
        segment: r.segment,
      }));

    // Avg purchase frequency (for repeat clients)
    const freqRaw = await prisma.$queryRaw<{ avg_frequency_days: string | null }[]>(
      Prisma.sql`SELECT AVG(per_client.avg_days)::text as avg_frequency_days
      FROM (
        SELECT gaps.client_id, AVG(gaps.day_diff) as avg_days
        FROM (
          SELECT client_id,
            EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY client_id ORDER BY created_at))) / 86400 as day_diff
          FROM deals
          WHERE status = 'CLOSED' AND is_archived = false
        ) gaps
        WHERE gaps.day_diff IS NOT NULL
        GROUP BY gaps.client_id
        HAVING COUNT(*) >= 1
      ) per_client`,
    );
    const avgFrequencyDays = freqRaw[0]?.avg_frequency_days ? Number(freqRaw[0].avg_frequency_days) : 0;

    const clients = {
      repeatRate,
      avgFrequencyDays: Math.round(avgFrequencyDays * 10) / 10,
      totalClients,
      repeatClients,
      segments,
      topByLTV,
    };

    // ════════════════════════════════════
    // ──── PRODUCT INTELLIGENCE ────
    // ════════════════════════════════════

    // Cross-sell pairs
    const crossSellRaw = await prisma.$queryRaw<{
      p1: string; p1_name: string; p2: string; p2_name: string; co_occurrences: string;
    }[]>(
      Prisma.sql`SELECT
        di1.product_id as p1, p1.name as p1_name,
        di2.product_id as p2, p2.name as p2_name,
        COUNT(DISTINCT di1.deal_id)::text as co_occurrences
      FROM deal_items di1
      JOIN deal_items di2 ON di1.deal_id = di2.deal_id AND di1.product_id < di2.product_id
      JOIN products p1 ON p1.id = di1.product_id
      JOIN products p2 ON p2.id = di2.product_id
      JOIN deals d ON d.id = di1.deal_id AND d.is_archived = false AND d.status = 'CLOSED'
      GROUP BY di1.product_id, p1.name, di2.product_id, p2.name
      ORDER BY COUNT(DISTINCT di1.deal_id) DESC
      LIMIT 10`,
    );

    const crossSellPairs = crossSellRaw.map((r) => ({
      product1Id: r.p1,
      product1Name: r.p1_name,
      product2Id: r.p2,
      product2Name: r.p2_name,
      coOccurrences: Number(r.co_occurrences),
    }));

    // Demand stability: CV of monthly line revenue per product (CLOSED deals, deal_items, Tashkent month)
    const stabilityRaw = await prisma.$queryRaw<{
      product_id: string; name: string; avg_monthly: string; cv: string | null;
    }[]>(
      Prisma.sql`SELECT sub.product_id, p.name,
        AVG(sub.monthly_rev)::text as avg_monthly,
        (STDDEV_SAMP(sub.monthly_rev) / NULLIF(AVG(sub.monthly_rev), 0))::text as cv
      FROM (
        SELECT di.product_id,
          DATE_TRUNC('month', (${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}) as month,
          SUM(${SQL_LINE_REVENUE_DI})::numeric as monthly_rev
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= NOW() - INTERVAL '12 months'
        GROUP BY di.product_id, DATE_TRUNC('month', (${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})
      ) sub
      JOIN products p ON p.id = sub.product_id
      GROUP BY sub.product_id, p.name
      HAVING COUNT(*) >= 3
      ORDER BY STDDEV_SAMP(sub.monthly_rev) / NULLIF(AVG(sub.monthly_rev), 0) ASC NULLS LAST
      LIMIT 15`,
    );

    const demandStability = stabilityRaw.map((r) => ({
      productId: r.product_id,
      name: r.name,
      avgMonthlySales: Math.round(Number(r.avg_monthly) * 10) / 10,
      coefficient: r.cv ? Math.round(Number(r.cv) * 100) / 100 : 0,
    }));

    // Seasonality: aggregate by calendar month (Tashkent) from CLOSED deal line dates
    const seasonalityRaw = await prisma.$queryRaw<{
      month: number; total_quantity: string; total_revenue: string;
    }[]>(
      Prisma.sql`SELECT EXTRACT(MONTH FROM (${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})::int as month,
        COALESCE(SUM(di.requested_qty), 0)::text as total_quantity,
        COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as total_revenue
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= NOW() - INTERVAL '12 months'
      GROUP BY EXTRACT(MONTH FROM (${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})
      ORDER BY month`,
    );

    const seasonality = seasonalityRaw.map((r) => ({
      month: r.month,
      totalQuantity: Number(r.total_quantity),
      totalRevenue: Number(r.total_revenue),
    }));

    const products = { crossSellPairs, demandStability, seasonality };

    // ════════════════════════════════════
    // ──── MANAGER INTELLIGENCE ────
    // ════════════════════════════════════

    const managerStatsRaw = await prisma.$queryRaw<{
      manager_id: string; full_name: string;
      completed_count: string; total_revenue: string; avg_deal_amount: string;
      total_deals: string; unique_clients: string; repeat_clients: string;
    }[]>(
      Prisma.sql`SELECT
        d.manager_id,
        u.full_name,
        COUNT(*) FILTER (WHERE d.status = 'CLOSED')::text as completed_count,
        COALESCE(SUM(di_rev.rev) FILTER (WHERE d.status = 'CLOSED'), 0)::text as total_revenue,
        COALESCE(AVG(di_rev.rev) FILTER (WHERE d.status = 'CLOSED'), 0)::text as avg_deal_amount,
        COUNT(*)::text as total_deals,
        COUNT(DISTINCT d.client_id)::text as unique_clients,
        (SELECT COUNT(*) FROM (
          SELECT d2.client_id
          FROM deals d2
          WHERE d2.manager_id = d.manager_id
            AND d2.status = 'CLOSED'
            AND d2.is_archived = false
            AND d2.created_at >= ${start} AND d2.created_at < ${end}
          GROUP BY d2.client_id
          HAVING COUNT(*) >= 2
        ) rc)::text as repeat_clients
      FROM deals d
      JOIN users u ON u.id = d.manager_id
      LEFT JOIN (
        SELECT deal_id, SUM(COALESCE(line_total, requested_qty * price, 0))::numeric as rev
        FROM deal_items GROUP BY deal_id
      ) di_rev ON di_rev.deal_id = d.id
      WHERE d.is_archived = false
        AND d.created_at >= ${start} AND d.created_at < ${end}
      GROUP BY d.manager_id, u.full_name
      ORDER BY SUM(di_rev.rev) FILTER (WHERE d.status = 'CLOSED') DESC NULLS LAST`,
    );

    const managerAvgDaysRaw = await prisma.$queryRaw<{ manager_id: string; avg_days: string }[]>(
      Prisma.sql`SELECT
        d.manager_id,
        AVG(EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) / 86400)::text as avg_days
      FROM deals d
      WHERE d.status = 'CLOSED' AND d.is_archived = false
        AND d.created_at >= ${start} AND d.created_at < ${end}
      GROUP BY d.manager_id`,
    );

    const avgDaysMap = new Map(managerAvgDaysRaw.map((m) => [m.manager_id, Number(m.avg_days)]));

    const managersRows = managerStatsRaw.map((m) => {
      const unique = Number(m.unique_clients);
      const repeat = Number(m.repeat_clients);
      return {
        managerId: m.manager_id,
        fullName: m.full_name,
        completedCount: Number(m.completed_count),
        totalRevenue: Number(m.total_revenue),
        avgDealAmount: Number(m.avg_deal_amount),
        conversionRate: Number(m.total_deals) > 0 ? Number(m.completed_count) / Number(m.total_deals) : 0,
        avgDealDays: avgDaysMap.get(m.manager_id) ?? 0,
        uniqueClients: unique,
        repeatClients: repeat,
        retentionRate: unique > 0 ? repeat / unique : 0,
      };
    });

    const managers = { rows: managersRows };

    // ════════════════════════════════════
    // ──── FINANCIAL INTELLIGENCE ────
    // ════════════════════════════════════

    // Revenue by payment method
    const revenueByMethodRaw = await prisma.$queryRaw<{
      method: string; total: string; count: string;
    }[]>(
      Prisma.sql`SELECT COALESCE(method, 'Не указан') as method,
        SUM(amount)::text as total,
        COUNT(*)::text as count
      FROM payments
      WHERE paid_at >= ${start} AND paid_at < ${end}
      GROUP BY COALESCE(method, 'Не указан')
      ORDER BY SUM(amount) DESC`,
    );

    const revenueByMethod = revenueByMethodRaw.map((r) => ({
      method: r.method,
      total: Number(r.total),
      count: Number(r.count),
    }));

    // Avg payment delay (days late relative to due_date, using last payment)
    const delayRaw = await prisma.$queryRaw<{ avg_days_late: string | null }[]>(
      Prisma.sql`SELECT AVG(GREATEST(0, EXTRACT(EPOCH FROM (p.last_paid - d.due_date)) / 86400))::text as avg_days_late
      FROM deals d
      JOIN (SELECT deal_id, MAX(paid_at) as last_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
      WHERE d.due_date IS NOT NULL AND d.status = 'CLOSED' AND d.is_archived = false`,
    );
    const avgPaymentDelayDays = delayRaw[0]?.avg_days_late ? Math.round(Number(delayRaw[0].avg_days_late) * 10) / 10 : 0;

    // On-time payment rate (last payment before or on due_date)
    const onTimeRaw = await prisma.$queryRaw<{ on_time_rate: string | null }[]>(
      Prisma.sql`SELECT
        (COUNT(*) FILTER (WHERE p.last_paid <= d.due_date)::float /
        NULLIF(COUNT(*), 0))::text as on_time_rate
      FROM deals d
      JOIN (SELECT deal_id, MAX(paid_at) as last_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
      WHERE d.due_date IS NOT NULL AND d.status = 'CLOSED' AND d.is_archived = false`,
    );
    const onTimePaymentRate = onTimeRaw[0]?.on_time_rate ? Number(onTimeRaw[0].on_time_rate) : 0;

    // Aging buckets for outstanding debt — only deals WITH due_date go into age buckets
    const agingRaw = await prisma.$queryRaw<{
      bucket_0_30: string; amount_0_30: string;
      bucket_31_60: string; amount_31_60: string;
      bucket_61_90: string; amount_61_90: string;
      bucket_90_plus: string; amount_90_plus: string;
      no_due_date_count: string; no_due_date_amount: string;
    }[]>(
      Prisma.sql`SELECT
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND age_days BETWEEN 0 AND 30)::text as bucket_0_30,
        COALESCE(SUM(debt) FILTER (WHERE due_date IS NOT NULL AND age_days BETWEEN 0 AND 30), 0)::text as amount_0_30,
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND age_days BETWEEN 31 AND 60)::text as bucket_31_60,
        COALESCE(SUM(debt) FILTER (WHERE due_date IS NOT NULL AND age_days BETWEEN 31 AND 60), 0)::text as amount_31_60,
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND age_days BETWEEN 61 AND 90)::text as bucket_61_90,
        COALESCE(SUM(debt) FILTER (WHERE due_date IS NOT NULL AND age_days BETWEEN 61 AND 90), 0)::text as amount_61_90,
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND age_days > 90)::text as bucket_90_plus,
        COALESCE(SUM(debt) FILTER (WHERE due_date IS NOT NULL AND age_days > 90), 0)::text as amount_90_plus,
        COUNT(*) FILTER (WHERE due_date IS NULL)::text as no_due_date_count,
        COALESCE(SUM(debt) FILTER (WHERE due_date IS NULL), 0)::text as no_due_date_amount
      FROM (
        SELECT d.id, d.due_date, (d.amount - d.paid_amount) as debt,
          CASE WHEN d.due_date IS NOT NULL
            THEN EXTRACT(DAY FROM NOW() - d.due_date)::int
            ELSE NULL
          END as age_days
        FROM deals d
        WHERE d.payment_status IN ('UNPAID','PARTIAL') AND d.is_archived = false
          AND (d.amount - d.paid_amount) > 0
      ) sub`,
    );
    const aging = agingRaw[0] ? {
      buckets: [
        { label: '0-30', count: Number(agingRaw[0].bucket_0_30), amount: Number(agingRaw[0].amount_0_30) },
        { label: '31-60', count: Number(agingRaw[0].bucket_31_60), amount: Number(agingRaw[0].amount_31_60) },
        { label: '61-90', count: Number(agingRaw[0].bucket_61_90), amount: Number(agingRaw[0].amount_61_90) },
        { label: '90+', count: Number(agingRaw[0].bucket_90_plus), amount: Number(agingRaw[0].amount_90_plus) },
      ],
      noDueDateCount: Number(agingRaw[0].no_due_date_count),
      noDueDateAmount: Number(agingRaw[0].no_due_date_amount),
    } : { buckets: [], noDueDateCount: 0, noDueDateAmount: 0 };

    const financial = {
      revenueByMethod,
      avgPaymentDelayDays,
      onTimePaymentRate,
      aging,
    };

    res.json({ clients, products, managers, financial });
  }),
);

export { router as intelligenceRoutes };
