import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_ANALYTICS_TZ,
  SQL_DEALS_CLOSED_REVENUE_FILTER,
  SQL_EFFECTIVE_ITEM_TS,
  SQL_LINE_REVENUE_DI,
} from '../../lib/analytics';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';
import { recommendationFor } from './abcXyzRecommendations';

const router = Router();
router.use(authenticate);

const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;

function getPeriodRange(period: string): { start: Date; end: Date } {
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
  const y = nowTashkent.getUTCFullYear();
  const m = nowTashkent.getUTCMonth();
  const d = nowTashkent.getUTCDate();
  const startOfTodayUtc = new Date(Date.UTC(y, m, d) - TASHKENT_OFFSET);
  const end = new Date(startOfTodayUtc.getTime() + 86400000);
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

type Abc = 'A' | 'B' | 'C';
type Xyz = 'X' | 'Y' | 'Z' | 'NEW';

function abcFromPrevCumulativeShare(prev: number): Abc {
  if (prev < 0.8) return 'A';
  if (prev < 0.95) return 'B';
  return 'C';
}

/** Fewer than 3 months with sales → NEW; else CV-based X/Y/Z. */
function xyzFromCvAndMonths(cv: number | null, monthCount: number): Xyz {
  if (monthCount < 3) return 'NEW';
  if (cv == null || !Number.isFinite(cv) || cv < 0) return 'Z';
  if (cv <= 0.1) return 'X';
  if (cv <= 0.25) return 'Y';
  return 'Z';
}

function meanStdCv(values: number[]): { cv: number | null } {
  const n = values.length;
  if (n < 3) return { cv: null };
  const avg = values.reduce((a, b) => a + b, 0) / n;
  if (avg === 0) return { cv: null };
  const varSum = values.reduce((s, v) => s + (v - avg) ** 2, 0);
  const std = Math.sqrt(varSum / (n - 1));
  return { cv: std / avg };
}

type EntityVolatility = { cv: number | null; monthCount: number };

function buildVolatilityMaps(
  monthlyRaw: { id: string; month: Date; rev: string }[],
): Map<string, EntityVolatility> {
  const byEntity = new Map<string, number[]>();
  for (const r of monthlyRaw) {
    const arr = byEntity.get(r.id) ?? [];
    arr.push(Number(r.rev));
    byEntity.set(r.id, arr);
  }
  const out = new Map<string, EntityVolatility>();
  for (const [id, vals] of byEntity) {
    out.set(id, {
      monthCount: vals.length,
      cv: meanStdCv(vals).cv,
    });
  }
  return out;
}

function buildRows(
  sorted: { id: string; name: string; revenue: number }[],
  volMap: Map<string, EntityVolatility>,
  kind: 'product' | 'client',
): {
  entityId: string;
  name: string;
  revenue: number;
  sharePercent: number;
  cumulativeSharePercent: number;
  abc: Abc;
  xyz: Xyz;
  combined: string;
  recommendation: {
    title: string;
    description: string;
    action: string;
    risk?: string;
  };
}[] {
  const total = sorted.reduce((s, r) => s + r.revenue, 0);
  let running = 0;
  return sorted.map((row) => {
    const sharePct = total > 0 ? (row.revenue / total) * 100 : 0;
    const prevCum = total > 0 ? running / total : 0;
    const abc = abcFromPrevCumulativeShare(prevCum);
    running += row.revenue;
    const cumPct = total > 0 ? (running / total) * 100 : 0;
    const vol = volMap.get(row.id) ?? { cv: null, monthCount: 0 };
    const xyz = xyzFromCvAndMonths(vol.cv, vol.monthCount);
    const combined = `${abc}${xyz}`;
    return {
      entityId: row.id,
      name: row.name,
      revenue: row.revenue,
      sharePercent: Math.round(sharePct * 100) / 100,
      cumulativeSharePercent: Math.round(cumPct * 100) / 100,
      abc,
      xyz,
      combined,
      recommendation: recommendationFor(combined, kind),
    };
  });
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

    const mgrFilter = dealScope.managerId
      ? Prisma.sql`AND d.manager_id = ${dealScope.managerId}`
      : Prisma.empty;

    const [productRevRaw, clientRevRaw, productMonthlyRaw, clientMonthlyRaw] = await Promise.all([
      prisma.$queryRaw<{ id: string; name: string; revenue: string }[]>(
        Prisma.sql`
        SELECT p.id, p.name, COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as revenue
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN products p ON p.id = di.product_id
        WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
          AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
          AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
          ${mgrFilter}
        GROUP BY p.id, p.name
        HAVING COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0) > 0
        ORDER BY SUM(${SQL_LINE_REVENUE_DI}) DESC`,
      ),
      prisma.$queryRaw<{ id: string; name: string; revenue: string }[]>(
        Prisma.sql`
        SELECT c.id, c.company_name as name, COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as revenue
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN clients c ON c.id = d.client_id
        WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
          AND c.is_archived = false
          AND ${SQL_EFFECTIVE_ITEM_TS} >= ${start}
          AND ${SQL_EFFECTIVE_ITEM_TS} < ${end}
          ${mgrFilter}
        GROUP BY c.id, c.company_name
        HAVING COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0) > 0
        ORDER BY SUM(${SQL_LINE_REVENUE_DI}) DESC`,
      ),
      prisma.$queryRaw<{ id: string; month: Date; rev: string }[]>(
        Prisma.sql`
        SELECT di.product_id as id,
          DATE_TRUNC('month', (${SQL_EFFECTIVE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}) as month,
          SUM(${SQL_LINE_REVENUE_DI})::text as rev
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
          AND ${SQL_EFFECTIVE_ITEM_TS} >= NOW() - INTERVAL '12 months'
          ${mgrFilter}
        GROUP BY di.product_id, DATE_TRUNC('month', (${SQL_EFFECTIVE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})`,
      ),
      prisma.$queryRaw<{ id: string; month: Date; rev: string }[]>(
        Prisma.sql`
        SELECT d.client_id as id,
          DATE_TRUNC('month', (${SQL_EFFECTIVE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}) as month,
          SUM(${SQL_LINE_REVENUE_DI})::text as rev
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE ${SQL_DEALS_CLOSED_REVENUE_FILTER}
          AND ${SQL_EFFECTIVE_ITEM_TS} >= NOW() - INTERVAL '12 months'
          ${mgrFilter}
        GROUP BY d.client_id, DATE_TRUNC('month', (${SQL_EFFECTIVE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})`,
      ),
    ]);

    const productVolMap = buildVolatilityMaps(productMonthlyRaw);
    const clientVolMap = buildVolatilityMaps(clientMonthlyRaw);

    const productsSorted = productRevRaw.map((r) => ({
      id: r.id,
      name: r.name,
      revenue: Number(r.revenue),
    }));
    const clientsSorted = clientRevRaw.map((r) => ({
      id: r.id,
      name: r.name,
      revenue: Number(r.revenue),
    }));

    res.json({
      period,
      products: buildRows(productsSorted, productVolMap, 'product'),
      clients: buildRows(clientsSorted, clientVolMap, 'client'),
    });
  }),
);

export { router as abcXyzRoutes };
