import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
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
import { responseCache } from '../../lib/responseCache';
import {
  NO_CATEGORY, addDays, buildAnalysis, resolvePeriods,
  type PeriodKind, type ProductInfo, type SaleLine,
} from './category-analysis.service';

const router = Router();
router.use(authenticate);
router.use(responseCache(2 * 60_000));

/** День строки по Ташкенту — как во всей аналитике выручки. */
const SQL_DAY = Prisma.sql`DATE((${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE ${SQL_ANALYTICS_TZ})`;
const SQL_CATEGORY = Prisma.sql`COALESCE(NULLIF(TRIM(p.category), ''), ${NO_CATEGORY})`;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayTashkent(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
}

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query;
    const kind: PeriodKind = q.period === 'r12' || q.period === 'custom' ? q.period : 'ytd';
    const from = typeof q.from === 'string' && DAY_RE.test(q.from) ? q.from : undefined;
    const to = typeof q.to === 'string' && DAY_RE.test(q.to) ? q.to : undefined;
    const category = typeof q.category === 'string' && q.category.trim() ? q.category.trim() : null;
    const excludeOwn = q.excludeOwn !== 'false';
    const today = todayTashkent();
    const periods = resolvePeriods(kind, today, from, to);
    const spanFrom = periods.prev.from < periods.cur.from ? periods.prev.from : periods.cur.from;

    const [lines, products] = await Promise.all([
      prisma.$queryRaw<{ deal_id: string; day: string; product_id: string; client_id: string; manager_id: string; own: boolean; rev: number; qty: number }[]>(Prisma.sql`
        SELECT d.id AS deal_id, ${SQL_DAY}::text AS day, di.product_id, d.client_id, d.manager_id,
               (c.relation = 'AFFILIATE') AS own,
               SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::float8 AS rev,
               SUM(COALESCE(di.requested_qty, 0))::float8 AS qty
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN clients c ON c.id = d.client_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND ${SQL_DAY} BETWEEN ${spanFrom}::date AND ${periods.cur.to}::date
        GROUP BY 1, 2, 3, 4, 5, 6
      `),
      prisma.$queryRaw<{ id: string; name: string; sku: string; unit: string; category: string; stock: number; min_stock: number; is_active: boolean }[]>(Prisma.sql`
        SELECT p.id, p.name, p.sku, p.unit, ${SQL_CATEGORY} AS category,
               p.stock::float8 AS stock, p.min_stock::float8 AS min_stock, p.is_active
        FROM products p
      `),
    ]);

    const categoryIds = category ? products.filter((p) => p.category === category).map((p) => p.id) : [];
    const [recent, last] = category && categoryIds.length
      ? await Promise.all([
        // Запас склада считаем от продаж за последние 90 дней, какой бы период ни смотрели
        prisma.$queryRaw<{ product_id: string; qty: number }[]>(Prisma.sql`
          SELECT di.product_id, SUM(COALESCE(di.requested_qty, 0))::float8 AS qty
          FROM deal_items di JOIN deals d ON d.id = di.deal_id
          WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
            AND di.product_id IN (${Prisma.join(categoryIds)})
            AND ${SQL_DAY} > ${addDays(today, -90)}::date
          GROUP BY 1
        `),
        prisma.$queryRaw<{ product_id: string; day: string }[]>(Prisma.sql`
          SELECT di.product_id, MAX(${SQL_DAY})::text AS day
          FROM deal_items di JOIN deals d ON d.id = di.deal_id
          WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
            AND di.product_id IN (${Prisma.join(categoryIds)})
          GROUP BY 1
        `),
      ])
      : [[], []];

    const productInfo: ProductInfo[] = products.map((p) => ({
      id: p.id, name: p.name, sku: p.sku, unit: p.unit, category: p.category,
      stock: Number(p.stock) || 0, minStock: Number(p.min_stock) || 0, isActive: p.is_active,
    }));
    const saleLines: SaleLine[] = lines.map((l) => ({
      dealId: l.deal_id, day: l.day, productId: l.product_id, clientId: l.client_id, managerId: l.manager_id,
      own: l.own, rev: Number(l.rev) || 0, qty: Number(l.qty) || 0,
    }));

    const analysis = buildAnalysis({
      periods,
      lines: saleLines,
      products: productInfo,
      qty90: new Map(recent.map((r) => [r.product_id, Number(r.qty) || 0])),
      lastSale: new Map(last.map((r) => [r.product_id, r.day])),
      category,
      excludeOwn,
    });

    // Имена клиентов и менеджеров — одним запросом на тех, кто попал в ответ
    const clientIds = analysis.clients.map((c) => c.id);
    const managerIds = [...new Set([...analysis.managers.map((m) => m.id), ...analysis.clients.map((c) => c.managerId)])];
    const [clientNames, userNames] = await Promise.all([
      clientIds.length ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, companyName: true } }) : [],
      managerIds.length ? prisma.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, fullName: true } }) : [],
    ]);
    const cName = new Map(clientNames.map((c) => [c.id, c.companyName]));
    const uName = new Map(userNames.map((u) => [u.id, u.fullName]));

    res.json({
      ...analysis,
      today,
      category,
      excludeOwn,
      clients: analysis.clients.map((c) => ({ ...c, name: cName.get(c.id) ?? '—', managerName: uName.get(c.managerId) ?? '—' })),
      managers: analysis.managers.map((m) => ({ ...m, name: uName.get(m.id) ?? '—' })),
      // Подписи для помесячного графика внутри категории
      productNames: category
        ? Object.fromEntries(analysis.products.map((p) => [p.id, p.name]))
        : undefined,
    });
  }),
);

export { router as categoryAnalysisRoutes };
