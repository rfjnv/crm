import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_ANALYTICS_TZ,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_ANALYTICS_LINE_REVENUE_DI,
} from '../../lib/analytics';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';

const router = Router();
router.use(authenticate);

/** Только последние N когорт (по месяцу первой покупки) — старые когорты малополезны и раздувают ответ. */
const MAX_COHORTS = 24;
/** Горизонт удержания — сколько месяцев после первой покупки показываем. */
const MAX_MONTH_OFFSET = 11;

type CohortRawRow = {
  cohort_month: Date;
  month_offset: number;
  active_clients: string;
  revenue: string;
};

type CohortSizeRow = {
  cohort_month: Date;
  cohort_size: string;
};

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
    };
    const isManager = user.role === 'MANAGER';
    const dealScope = ownerScope(user);
    const managerIdFromQuery =
      typeof req.query.managerId === 'string' && req.query.managerId.length > 0 ? req.query.managerId : undefined;
    // Managers always see their own scope; picking another manager is admin-only.
    const managerId = isManager ? dealScope.managerId : managerIdFromQuery;

    const mgrFilter = managerId ? Prisma.sql`AND d.manager_id = ${managerId}` : Prisma.empty;

    const [cohortSizeRaw, cohortRaw] = await Promise.all([
      prisma.$queryRaw<CohortSizeRow[]>(
        Prisma.sql`
        WITH deal_scope AS (
          SELECT d.client_id,
            DATE_TRUNC('month', (${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}) as month
          FROM deal_items di
          JOIN deals d ON d.id = di.deal_id
          WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER} ${mgrFilter}
        ),
        client_first AS (
          SELECT client_id, MIN(month) as cohort_month
          FROM deal_scope
          GROUP BY client_id
        )
        SELECT cohort_month, COUNT(*)::text as cohort_size
        FROM client_first
        GROUP BY cohort_month
        ORDER BY cohort_month DESC
        LIMIT ${MAX_COHORTS}`,
      ),
      prisma.$queryRaw<CohortRawRow[]>(
        Prisma.sql`
        WITH deal_scope AS (
          SELECT d.client_id,
            DATE_TRUNC('month', (${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}) as month,
            ${SQL_ANALYTICS_LINE_REVENUE_DI} as rev
          FROM deal_items di
          JOIN deals d ON d.id = di.deal_id
          WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER} ${mgrFilter}
        ),
        client_first AS (
          SELECT client_id, MIN(month) as cohort_month
          FROM deal_scope
          GROUP BY client_id
        ),
        client_month_activity AS (
          SELECT client_id, month, SUM(rev) as revenue
          FROM deal_scope
          GROUP BY client_id, month
        )
        SELECT * FROM (
          SELECT
            cf.cohort_month,
            (
              (EXTRACT(YEAR FROM cma.month) * 12 + EXTRACT(MONTH FROM cma.month))
              - (EXTRACT(YEAR FROM cf.cohort_month) * 12 + EXTRACT(MONTH FROM cf.cohort_month))
            )::int as month_offset,
            COUNT(DISTINCT cma.client_id)::text as active_clients,
            COALESCE(SUM(cma.revenue), 0)::text as revenue
          FROM client_first cf
          JOIN client_month_activity cma ON cma.client_id = cf.client_id
          WHERE cf.cohort_month >= (SELECT MIN(cohort_month) FROM (
            SELECT cohort_month FROM client_first GROUP BY cohort_month ORDER BY cohort_month DESC LIMIT ${MAX_COHORTS}
          ) recent_cohorts)
          GROUP BY cf.cohort_month, month_offset
        ) sub
        WHERE month_offset BETWEEN 0 AND ${MAX_MONTH_OFFSET}
        ORDER BY cohort_month, month_offset`,
      ),
    ]);

    const cohortSizeMap = new Map(cohortSizeRaw.map((r) => [monthKey(r.cohort_month), Number(r.cohort_size)]));

    type Point = {
      monthOffset: number;
      activeClients: number;
      retentionPercent: number;
      revenue: number;
      revenuePerCohortClient: number;
    };
    const pointsByCohort = new Map<string, Point[]>();
    for (const row of cohortRaw) {
      const key = monthKey(row.cohort_month);
      const cohortSize = cohortSizeMap.get(key) ?? 0;
      if (cohortSize === 0) continue;
      const activeClients = Number(row.active_clients);
      const revenue = Number(row.revenue);
      const list = pointsByCohort.get(key) ?? [];
      list.push({
        monthOffset: row.month_offset,
        activeClients,
        retentionPercent: Math.round((activeClients / cohortSize) * 10000) / 100,
        revenue,
        revenuePerCohortClient: Math.round((revenue / cohortSize) * 100) / 100,
      });
      pointsByCohort.set(key, list);
    }

    const cohorts = [...cohortSizeMap.entries()]
      .map(([cohortMonth, cohortSize]) => ({
        cohortMonth,
        cohortSize,
        points: (pointsByCohort.get(cohortMonth) ?? []).sort((a, b) => a.monthOffset - b.monthOffset),
      }))
      .sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth));

    res.json({
      cohorts,
      maxMonthOffset: MAX_MONTH_OFFSET,
    });
  }),
);

export { router as cohortsRoutes };
