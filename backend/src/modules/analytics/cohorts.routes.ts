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
import { AppError } from '../../lib/errors';

const router = Router();
router.use(authenticate);

/** Только последние N когорт — старые когорты малополезны и раздувают ответ. */
const MAX_COHORTS = 24;
/** Горизонт удержания — сколько месяцев после старта когорты показываем. */
const MAX_MONTH_OFFSET = 11;

/**
 * 'new' — когорта = клиенты, для которых этот месяц был САМОЙ ПЕРВОЙ покупкой за всю историю
 *   (классический acquisition retention, узкая когорта).
 * 'all' — когорта = ВСЕ клиенты, купившие в этот месяц (новые и старые вперемешку); дальше смотрим,
 *   сколько из НИХ ЖЕ купило повторно через N месяцев. Один и тот же клиент может входить сразу
 *   в несколько когорт (если покупал в разные месяцы) — это ожидаемо для этого режима.
 */
type CohortMode = 'new' | 'all';

function parseMode(req: Request): CohortMode {
  return req.query.mode === 'all' ? 'all' : 'new';
}

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
    const mode = parseMode(req);

    const [cohortSizeRaw, cohortRaw] = mode === 'all'
      ? await Promise.all([
          prisma.$queryRaw<CohortSizeRow[]>(
            Prisma.sql`
            WITH deal_scope AS (
              SELECT d.client_id,
                DATE_TRUNC('month', (${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}) as month
              FROM deal_items di
              JOIN deals d ON d.id = di.deal_id
              WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER} ${mgrFilter}
            )
            SELECT month as cohort_month, COUNT(DISTINCT client_id)::text as cohort_size
            FROM deal_scope
            GROUP BY month
            ORDER BY month DESC
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
            client_month_activity AS (
              SELECT client_id, month, SUM(rev) as revenue
              FROM deal_scope
              GROUP BY client_id, month
            )
            SELECT * FROM (
              SELECT
                ma1.month as cohort_month,
                (
                  (EXTRACT(YEAR FROM ma2.month) * 12 + EXTRACT(MONTH FROM ma2.month))
                  - (EXTRACT(YEAR FROM ma1.month) * 12 + EXTRACT(MONTH FROM ma1.month))
                )::int as month_offset,
                COUNT(DISTINCT ma2.client_id)::text as active_clients,
                COALESCE(SUM(ma2.revenue), 0)::text as revenue
              FROM client_month_activity ma1
              JOIN client_month_activity ma2 ON ma2.client_id = ma1.client_id AND ma2.month >= ma1.month
              WHERE ma1.month >= (SELECT MIN(month) FROM (
                SELECT DISTINCT month FROM client_month_activity ORDER BY month DESC LIMIT ${MAX_COHORTS}
              ) recent_months)
              GROUP BY ma1.month, month_offset
            ) sub
            WHERE month_offset BETWEEN 0 AND ${MAX_MONTH_OFFSET}
            ORDER BY cohort_month, month_offset`,
          ),
        ])
      : await Promise.all([
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
      mode,
    });
  }),
);

const COHORT_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type CohortClientRawRow = {
  client_id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  revenue_this_month: string;
  is_active: boolean;
  last_purchase_at: Date | null;
  last_contact_at: Date | null;
  last_contact_by: string | null;
};

/** Клиенты когорты на конкретный месяц после первой покупки — для drill-down по клику на ячейку retention. */
router.get(
  '/:cohortMonth/:monthOffset/clients',
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
    const managerId = isManager ? dealScope.managerId : managerIdFromQuery;
    const mgrFilter = managerId ? Prisma.sql`AND d.manager_id = ${managerId}` : Prisma.empty;
    const mode = parseMode(req);

    const cohortMonth = req.params.cohortMonth as string;
    if (!COHORT_MONTH_RE.test(cohortMonth)) {
      throw new AppError(400, 'Некорректный формат месяца когорты (ожидается YYYY-MM)');
    }
    const monthOffset = Number(req.params.monthOffset as string);
    if (!Number.isInteger(monthOffset) || monthOffset < 0 || monthOffset > MAX_MONTH_OFFSET) {
      throw new AppError(400, 'Некорректный офсет месяца');
    }
    const [cohortYear, cohortMonthNum] = cohortMonth.split('-').map(Number);
    const cohortKey = cohortYear * 12 + cohortMonthNum;
    const targetKey = cohortKey + monthOffset;

    // 'new' — клиент попадает в когорту, только если этот месяц был его самой первой покупкой.
    // 'all' — в когорту входит любой клиент, купивший в этот месяц (новый или давний).
    const cohortMembersCte =
      mode === 'all'
        ? Prisma.sql`
      cohort_members AS (
        SELECT DISTINCT client_id
        FROM deal_scope
        WHERE (
          (EXTRACT(YEAR FROM DATE_TRUNC('month', (ts AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})) * 12)
          + EXTRACT(MONTH FROM DATE_TRUNC('month', (ts AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}))
        )::int = ${cohortKey}
      ),`
        : Prisma.sql`
      client_first AS (
        SELECT client_id, MIN(DATE_TRUNC('month', (ts AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})) as cohort_month
        FROM deal_scope
        GROUP BY client_id
      ),
      cohort_members AS (
        SELECT client_id FROM client_first
        WHERE (
          (EXTRACT(YEAR FROM cohort_month) * 12 + EXTRACT(MONTH FROM cohort_month))
        )::int = ${cohortKey}
      ),`;

    const rows = await prisma.$queryRaw<CohortClientRawRow[]>(
      Prisma.sql`
      WITH deal_scope AS (
        SELECT d.client_id,
          ${SQL_EFFECTIVE_REVENUE_ITEM_TS} as ts,
          ${SQL_ANALYTICS_LINE_REVENUE_DI} as rev
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER} ${mgrFilter}
      ),
      ${cohortMembersCte}
      month_activity AS (
        SELECT ds.client_id,
          (
            (EXTRACT(YEAR FROM DATE_TRUNC('month', (ds.ts AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})) * 12)
            + EXTRACT(MONTH FROM DATE_TRUNC('month', (ds.ts AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ}))
          )::int as month_key,
          ds.rev
        FROM deal_scope ds
        WHERE ds.client_id IN (SELECT client_id FROM cohort_members)
      ),
      this_month AS (
        SELECT client_id, SUM(rev) as revenue
        FROM month_activity
        WHERE month_key = ${targetKey}
        GROUP BY client_id
      ),
      last_purchase AS (
        SELECT client_id, MAX(ts) as last_ts
        FROM deal_scope
        WHERE client_id IN (SELECT client_id FROM cohort_members)
        GROUP BY client_id
      ),
      last_note AS (
        SELECT DISTINCT ON (cn.client_id) cn.client_id, cn.created_at, u.full_name as author_name
        FROM client_notes cn
        JOIN users u ON u.id = cn.user_id
        WHERE cn.deleted_at IS NULL AND cn.client_id IN (SELECT client_id FROM cohort_members)
        ORDER BY cn.client_id, cn.created_at DESC
      )
      SELECT
        c.id as client_id,
        c.company_name,
        c.contact_name,
        c.phone,
        c.email,
        COALESCE(tm.revenue, 0)::text as revenue_this_month,
        (tm.client_id IS NOT NULL) as is_active,
        lp.last_ts as last_purchase_at,
        ln.created_at as last_contact_at,
        ln.author_name as last_contact_by
      FROM cohort_members cm
      JOIN clients c ON c.id = cm.client_id
      LEFT JOIN this_month tm ON tm.client_id = cm.client_id
      LEFT JOIN last_purchase lp ON lp.client_id = cm.client_id
      LEFT JOIN last_note ln ON ln.client_id = cm.client_id
      ORDER BY (tm.client_id IS NOT NULL) DESC, COALESCE(tm.revenue, 0) DESC, c.company_name ASC`,
    );

    res.json({
      cohortMonth,
      monthOffset,
      mode,
      clients: rows.map((r) => ({
        clientId: r.client_id,
        companyName: r.company_name,
        contactName: r.contact_name,
        phone: r.phone,
        email: r.email,
        active: r.is_active,
        revenueThisMonth: Number(r.revenue_this_month),
        lastPurchaseAt: r.last_purchase_at ? r.last_purchase_at.toISOString() : null,
        lastContactAt: r.last_contact_at ? r.last_contact_at.toISOString() : null,
        lastContactByName: r.last_contact_by,
      })),
    });
  }),
);

export { router as cohortsRoutes };
