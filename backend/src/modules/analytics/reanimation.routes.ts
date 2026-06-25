import { Router, Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../lib/config';
import prisma from '../../lib/prisma';
import {
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
} from '../../lib/analytics';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { authorize } from '../../middleware/authorize';
import { ownerScope, type AuthUser } from '../../lib/scope';
import { AppError } from '../../lib/errors';

const anthropic = new Anthropic({ apiKey: config.claude.apiKey });

const router = Router();

router.use(authenticate);

const TASHKENT_TZ = Prisma.sql`'Asia/Tashkent'`;
const ONE_TIME_LOST_DAYS = 30;
const REPEAT_SLEEPING_DAYS = 30;
const REPEAT_CHURNED_DAYS = 60;

type BaseClientRow = {
  client_id: string;
  company_name: string;
  contact_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_svip: boolean;
  credit_status: 'NORMAL' | 'SATISFACTORY' | 'NEGATIVE';
  manager_id: string;
  manager_name: string | null;
  manager_department: string | null;
  closed_deals_count: string;
  total_revenue: string;
  avg_deal_amount: string;
  first_purchase_at: Date;
  last_purchase_at: Date;
  active_months_count: string;
};

type LastDealRow = {
  client_id: string;
  deal_id: string;
  deal_title: string;
  deal_revenue: string;
  effective_ts: Date;
  created_at: Date;
};

type LastNoteRow = {
  client_id: string;
  created_at: Date;
  author_name: string;
  content: string;
};

type DebtRow = {
  client_id: string;
  current_debt: string;
};

type ProductAggRow = {
  client_id: string;
  product_id: string;
  product_name: string;
  total_qty: string;
  total_revenue: string;
  last_purchased_at: Date;
  deals_count: string;
};

type ClientProductNameRow = {
  client_id: string;
  product_id: string;
  product_name: string;
};

/** Only clients inactive 30+ days (all reanimation candidates). */
const SQL_REANIMATION_CANDIDATE_HAVING = Prisma.sql`
  HAVING MAX(ds.effective_ts) < (NOW() AT TIME ZONE 'UTC' - INTERVAL '30 days')`;

type DealProductRow = {
  deal_id: string;
  product_id: string;
  product_name: string;
  qty: string;
  revenue: string;
};

type RecentDealRow = {
  deal_id: string;
  deal_title: string;
  created_at: Date;
  effective_ts: Date;
  deal_revenue: string;
  amount: string;
  paid_amount: string;
  payment_status: string;
};

type RecentNoteRow = {
  id: string;
  created_at: Date;
  author_name: string;
  content: string;
};

type ReanimationStatus = 'ACTIVE' | 'ONE_TIME_LOST' | 'SLEEPING' | 'CHURNED';

function getAuthUser(req: Request): AuthUser {
  return {
    userId: req.user!.userId,
    role: req.user!.role as Role,
    permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
  };
}

function getDealFilter(user: AuthUser) {
  const scope = ownerScope(user);
  return scope.managerId
    ? Prisma.sql` AND d.manager_id = ${scope.managerId}`
    : Prisma.sql``;
}

function daysSince(isoOrDate: string | Date | null | undefined): number | null {
  if (!isoOrDate) return null;
  const ms = new Date(isoOrDate).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

function classifyStatus(closedDealsCount: number, daysSinceLastPurchase: number | null): ReanimationStatus {
  const days = daysSinceLastPurchase ?? 0;
  if (closedDealsCount <= 1) {
    return days >= ONE_TIME_LOST_DAYS ? 'ONE_TIME_LOST' : 'ACTIVE';
  }
  if (days >= REPEAT_CHURNED_DAYS) return 'CHURNED';
  if (days >= REPEAT_SLEEPING_DAYS) return 'SLEEPING';
  return 'ACTIVE';
}

function buildProductPreview(row: { product_id: string; product_name: string; total_qty: string; total_revenue: string; last_purchased_at?: Date }) {
  return {
    productId: row.product_id,
    productName: row.product_name,
    qty: Math.round(Number(row.total_qty) * 100) / 100,
    revenue: Number(row.total_revenue),
    lastPurchasedAt: row.last_purchased_at ? row.last_purchased_at.toISOString() : null,
  };
}

async function loadBaseClientRows(user: AuthUser, clientId?: string) {
  const dealFilter = getDealFilter(user);
  const clientFilter = clientId ? Prisma.sql` AND c.id = ${clientId}` : Prisma.sql``;
  const candidateHaving = clientId ? Prisma.sql`` : SQL_REANIMATION_CANDIDATE_HAVING;

  return prisma.$queryRaw<BaseClientRow[]>(
    Prisma.sql`WITH deal_scope AS (
      SELECT
        d.id AS deal_id,
        d.client_id,
        MAX(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) AS effective_ts,
        COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::numeric AS deal_revenue
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}${dealFilter}
      GROUP BY d.id, d.client_id
    )
    SELECT
      c.id AS client_id,
      c.company_name,
      c.contact_name,
      c.phone,
      c.email,
      c.address,
      c.is_svip,
      c.credit_status,
      c.manager_id,
      u.full_name AS manager_name,
      u.department AS manager_department,
      COUNT(ds.deal_id)::text AS closed_deals_count,
      COALESCE(SUM(ds.deal_revenue), 0)::text AS total_revenue,
      COALESCE(AVG(ds.deal_revenue), 0)::text AS avg_deal_amount,
      MIN(ds.effective_ts) AS first_purchase_at,
      MAX(ds.effective_ts) AS last_purchase_at,
      COUNT(DISTINCT DATE_TRUNC('month', (ds.effective_ts AT TIME ZONE 'UTC') AT TIME ZONE ${TASHKENT_TZ}))::text AS active_months_count
    FROM deal_scope ds
    JOIN clients c ON c.id = ds.client_id
    LEFT JOIN users u ON u.id = c.manager_id
    WHERE c.is_archived = false${clientFilter}
    GROUP BY
      c.id,
      c.company_name,
      c.contact_name,
      c.phone,
      c.email,
      c.address,
      c.is_svip,
      c.credit_status,
      c.manager_id,
      u.full_name,
      u.department
    ${candidateHaving}
    ORDER BY MAX(ds.effective_ts) ASC, c.company_name ASC`,
  );
}

async function enrichClientRows(
  user: AuthUser,
  baseRows: BaseClientRow[],
  opts: { includeProductPreviews: boolean },
) {
  if (baseRows.length === 0) return [];

  const clientIds = baseRows.map((row) => row.client_id);
  const dealFilter = getDealFilter(user);

  const [lastDealRows, lastNoteRows, debtRows, productNameRows, productRows] = await Promise.all([
    prisma.$queryRaw<LastDealRow[]>(
      Prisma.sql`WITH deal_scope AS (
        SELECT
          d.id AS deal_id,
          d.client_id,
          d.title AS deal_title,
          MAX(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) AS effective_ts,
          MAX(d.created_at) AS created_at,
          COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::numeric AS deal_revenue
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND d.client_id IN (${Prisma.join(clientIds)})${dealFilter}
        GROUP BY d.id, d.client_id, d.title
      )
      SELECT DISTINCT ON (client_id)
        client_id,
        deal_id,
        deal_title,
        deal_revenue::text AS deal_revenue,
        effective_ts,
        created_at
      FROM deal_scope
      ORDER BY client_id, effective_ts DESC, created_at DESC, deal_id DESC`,
    ),
    prisma.$queryRaw<LastNoteRow[]>(
      Prisma.sql`SELECT DISTINCT ON (cn.client_id)
        cn.client_id,
        cn.created_at,
        u.full_name AS author_name,
        cn.content
      FROM client_notes cn
      JOIN users u ON u.id = cn.user_id
      WHERE cn.deleted_at IS NULL
        AND cn.client_id IN (${Prisma.join(clientIds)})
      ORDER BY cn.client_id, cn.created_at DESC`,
    ),
    prisma.$queryRaw<DebtRow[]>(
      Prisma.sql`SELECT
        d.client_id,
        (COALESCE(SUM(d.amount), 0) - COALESCE(SUM(d.paid_amount), 0))::text AS current_debt
      FROM deals d
      WHERE d.client_id IN (${Prisma.join(clientIds)})
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED', 'REJECTED')${dealFilter}
      GROUP BY d.client_id`,
    ),
    prisma.$queryRaw<ClientProductNameRow[]>(
      Prisma.sql`SELECT DISTINCT
        d.client_id,
        di.product_id,
        p.name AS product_name
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND d.client_id IN (${Prisma.join(clientIds)})${dealFilter}`,
    ),
    opts.includeProductPreviews
      ? prisma.$queryRaw<ProductAggRow[]>(
          Prisma.sql`SELECT
            d.client_id,
            di.product_id,
            p.name AS product_name,
            COALESCE(SUM(di.requested_qty), 0)::text AS total_qty,
            COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text AS total_revenue,
            MAX(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) AS last_purchased_at,
            COUNT(DISTINCT d.id)::text AS deals_count
          FROM deal_items di
          JOIN deals d ON d.id = di.deal_id
          JOIN products p ON p.id = di.product_id
          WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
            AND d.client_id IN (${Prisma.join(clientIds)})${dealFilter}
          GROUP BY d.client_id, di.product_id, p.name
          ORDER BY d.client_id ASC, SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}) DESC, p.name ASC`,
        )
      : Promise.resolve([] as ProductAggRow[]),
  ]);

  const lastDealByClient = new Map(lastDealRows.map((row) => [row.client_id, row]));
  const lastNoteByClient = new Map(lastNoteRows.map((row) => [row.client_id, row]));
  const debtByClient = new Map(debtRows.map((row) => [row.client_id, Number(row.current_debt)]));
  const topProductsByClient = new Map<string, ReturnType<typeof buildProductPreview>[]>();
  const allProductNamesByClient = new Map<string, string[]>();
  const allProductIdsByClient = new Map<string, string[]>();

  for (const row of productNameRows) {
    const names = allProductNamesByClient.get(row.client_id) ?? [];
    names.push(row.product_name);
    allProductNamesByClient.set(row.client_id, names);

    const ids = allProductIdsByClient.get(row.client_id) ?? [];
    ids.push(row.product_id);
    allProductIdsByClient.set(row.client_id, ids);
  }

  if (opts.includeProductPreviews) {
    for (const row of productRows) {
      const preview = buildProductPreview(row);
      const topList = topProductsByClient.get(row.client_id) ?? [];
      topList.push(preview);
      topProductsByClient.set(row.client_id, topList);
    }
  }

  const lastDealIds = opts.includeProductPreviews ? lastDealRows.map((row) => row.deal_id) : [];
  const lastDealProductsByDeal = new Map<string, ReturnType<typeof buildProductPreview>[]>();

  if (lastDealIds.length > 0) {
    const lastDealProductRows = await prisma.$queryRaw<DealProductRow[]>(
      Prisma.sql`SELECT
        di.deal_id,
        di.product_id,
        p.name AS product_name,
        COALESCE(SUM(di.requested_qty), 0)::text AS qty,
        COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text AS revenue
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      WHERE di.deal_id IN (${Prisma.join(lastDealIds)})
      GROUP BY di.deal_id, di.product_id, p.name
      ORDER BY di.deal_id ASC, SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}) DESC, p.name ASC`,
    );

    for (const row of lastDealProductRows) {
      const items = lastDealProductsByDeal.get(row.deal_id) ?? [];
      items.push({
        productId: row.product_id,
        productName: row.product_name,
        qty: Math.round(Number(row.qty) * 100) / 100,
        revenue: Number(row.revenue),
        lastPurchasedAt: null,
      });
      lastDealProductsByDeal.set(row.deal_id, items);
    }
  }

  return baseRows.map((row) => {
    const lastDeal = lastDealByClient.get(row.client_id);
    const lastNote = lastNoteByClient.get(row.client_id);
    const daysSinceLastPurchase = daysSince(row.last_purchase_at);
    const daysSinceLastContact = daysSince(lastNote?.created_at);
    const closedDealsCount = Number(row.closed_deals_count);

    return {
      clientId: row.client_id,
      companyName: row.company_name,
      contactName: row.contact_name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      isSvip: row.is_svip,
      creditStatus: row.credit_status,
      managerId: row.manager_id,
      managerName: row.manager_name || '—',
      managerDepartment: row.manager_department,
      closedDealsCount,
      totalRevenue: Number(row.total_revenue),
      avgDealAmount: Number(row.avg_deal_amount),
      firstPurchaseAt: row.first_purchase_at.toISOString(),
      lastPurchaseAt: row.last_purchase_at.toISOString(),
      daysSinceLastPurchase,
      activeMonthsCount: Number(row.active_months_count),
      currentDebt: debtByClient.get(row.client_id) ?? 0,
      status: classifyStatus(closedDealsCount, daysSinceLastPurchase),
      lastDeal: lastDeal
        ? {
            dealId: lastDeal.deal_id,
            title: lastDeal.deal_title,
            revenue: Number(lastDeal.deal_revenue),
            effectiveAt: lastDeal.effective_ts.toISOString(),
            createdAt: lastDeal.created_at.toISOString(),
          }
        : null,
      lastContactAt: lastNote?.created_at ? lastNote.created_at.toISOString() : null,
      lastContactByName: lastNote?.author_name ?? null,
      lastContactPreview: lastNote?.content ? (lastNote.content.length > 180 ? `${lastNote.content.slice(0, 180)}...` : lastNote.content) : null,
      daysSinceLastContact,
      topProducts: (topProductsByClient.get(row.client_id) ?? []).slice(0, 5),
      lastDealProducts: lastDeal ? (lastDealProductsByDeal.get(lastDeal.deal_id) ?? []).slice(0, 6) : [],
      productNames: Array.from(new Set(allProductNamesByClient.get(row.client_id) ?? [])),
      productIds: Array.from(new Set(allProductIdsByClient.get(row.client_id) ?? [])),
    };
  });
}

async function loadListRows(user: AuthUser) {
  const baseRows = await loadBaseClientRows(user);
  return enrichClientRows(user, baseRows, { includeProductPreviews: false });
}

async function loadClientSummary(user: AuthUser, clientId: string) {
  const baseRows = await loadBaseClientRows(user, clientId);
  const rows = await enrichClientRows(user, baseRows, { includeProductPreviews: true });
  return rows[0] ?? null;
}

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    const rows = await loadListRows(user);
    res.json(rows);
  }),
);

router.get(
  '/:clientId',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    const clientId = req.params.clientId as string;
    const dealFilter = getDealFilter(user);

    const client = await loadClientSummary(user, clientId);
    if (!client) {
      throw new AppError(404, 'Клиент не найден или недоступен');
    }

    const [recentDeals, productStats, notes] = await Promise.all([
      prisma.$queryRaw<RecentDealRow[]>(
        Prisma.sql`WITH deal_scope AS (
          SELECT
            d.id AS deal_id,
            d.client_id,
            d.title AS deal_title,
            d.created_at,
            d.amount,
            d.paid_amount,
            d.payment_status,
            MAX(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) AS effective_ts,
            COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::numeric AS deal_revenue
          FROM deal_items di
          JOIN deals d ON d.id = di.deal_id
          WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
            AND d.client_id = ${clientId}${dealFilter}
          GROUP BY d.id, d.client_id, d.title, d.created_at, d.amount, d.paid_amount, d.payment_status
        )
        SELECT
          deal_id,
          deal_title,
          created_at,
          effective_ts,
          deal_revenue::text AS deal_revenue,
          amount::text,
          paid_amount::text AS paid_amount,
          payment_status
        FROM deal_scope
        ORDER BY effective_ts DESC, created_at DESC, deal_id DESC
        LIMIT 15`,
      ),
      prisma.$queryRaw<ProductAggRow[]>(
        Prisma.sql`SELECT
          d.client_id,
          di.product_id,
          p.name AS product_name,
          COALESCE(SUM(di.requested_qty), 0)::text AS total_qty,
          COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text AS total_revenue,
          MAX(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) AS last_purchased_at,
          COUNT(DISTINCT d.id)::text AS deals_count
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN products p ON p.id = di.product_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND d.client_id = ${clientId}${dealFilter}
        GROUP BY d.client_id, di.product_id, p.name
        ORDER BY SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}) DESC, p.name ASC`,
      ),
      prisma.$queryRaw<RecentNoteRow[]>(
        Prisma.sql`SELECT
          cn.id,
          cn.created_at,
          u.full_name AS author_name,
          cn.content
        FROM client_notes cn
        JOIN users u ON u.id = cn.user_id
        WHERE cn.deleted_at IS NULL
          AND cn.client_id = ${clientId}
        ORDER BY cn.created_at DESC
        LIMIT 12`,
      ),
    ]);

    res.json({
      client,
      recentDeals: recentDeals.map((row) => ({
        dealId: row.deal_id,
        title: row.deal_title,
        createdAt: row.created_at.toISOString(),
        effectiveAt: row.effective_ts.toISOString(),
        revenue: Number(row.deal_revenue),
        amount: Number(row.amount),
        paidAmount: Number(row.paid_amount),
        paymentStatus: row.payment_status,
      })),
      productStats: productStats.map((row) => ({
        productId: row.product_id,
        productName: row.product_name,
        totalQty: Math.round(Number(row.total_qty) * 100) / 100,
        totalRevenue: Number(row.total_revenue),
        lastPurchasedAt: row.last_purchased_at.toISOString(),
        dealsCount: Number(row.deals_count),
      })),
      notes: notes.map((row) => ({
        id: row.id,
        createdAt: row.created_at.toISOString(),
        authorName: row.author_name,
        preview: row.content.length > 400 ? `${row.content.slice(0, 400)}...` : row.content,
      })),
    });
  }),
);

// ==================== AI Report ====================

const PAGE_KEY = 'reanimation';
const REGEN_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours for non-admins

router.get(
  '/ai-report',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'),
  asyncHandler(async (_req: Request, res: Response) => {
    const report = await prisma.aiReport.findUnique({
      where: { pageKey: PAGE_KEY },
      include: { author: { select: { fullName: true } } },
    });
    if (!report) {
      res.json(null);
      return;
    }
    res.json({
      id: report.id,
      content: report.content,
      generatedBy: report.author.fullName,
      generatedAt: report.generatedAt.toISOString(),
    });
  }),
);

router.post(
  '/ai-report',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const role = req.user!.role as Role;
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';

    // Throttle for non-admins: max once per 4 hours
    if (!isAdmin) {
      const existing = await prisma.aiReport.findUnique({ where: { pageKey: PAGE_KEY } });
      if (existing) {
        const age = Date.now() - existing.generatedAt.getTime();
        if (age < REGEN_COOLDOWN_MS) {
          const waitMin = Math.ceil((REGEN_COOLDOWN_MS - age) / 60_000);
          throw new AppError(429, `Отчёт был сгенерирован недавно. Повторная генерация будет доступна через ${waitMin} мин.`);
        }
      }
    }

    // Load reanimation data (admin scope — full data for the report)
    const adminUser: AuthUser = { userId, role, permissions: [], companyId: req.user!.companyId };
    const baseRows = await loadBaseClientRows(adminUser);
    const rows = await enrichClientRows(adminUser, baseRows, { includeProductPreviews: false });

    const totalClients = rows.length;
    const withDebt = rows.filter((r) => r.currentDebt > 0);
    const totalDebt = withDebt.reduce((s, r) => s + r.currentDebt, 0);
    const churned = rows.filter((r) => r.status === 'CHURNED');
    const onceAndGone = rows.filter((r) => r.status === 'ONE_TIME_LOST');
    const sleeping = rows.filter((r) => r.status === 'SLEEPING');
    const totalRevenueLost = rows.reduce((s, r) => s + r.totalRevenue, 0);
    const avgDaysSince = rows.length
      ? Math.round(rows.reduce((s, r) => s + (r.daysSinceLastPurchase ?? 0), 0) / rows.length)
      : 0;

    // Top clients by revenue
    const topByRevenue = [...rows].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 10);
    // Top clients by debt
    const topByDebt = [...withDebt].sort((a, b) => b.currentDebt - a.currentDebt).slice(0, 10);
    // Longest inactive
    const longestInactive = [...rows]
      .sort((a, b) => (b.daysSinceLastPurchase ?? 0) - (a.daysSinceLastPurchase ?? 0))
      .slice(0, 10);
    // Manager breakdown
    const byManager = new Map<string, { name: string; count: number; revenue: number; debt: number }>();
    for (const r of rows) {
      const entry = byManager.get(r.managerId) ?? { name: r.managerName, count: 0, revenue: 0, debt: 0 };
      entry.count++;
      entry.revenue += r.totalRevenue;
      entry.debt += r.currentDebt;
      byManager.set(r.managerId, entry);
    }
    const managerStats = Array.from(byManager.values()).sort((a, b) => b.count - a.count);

    const formatMoney = (v: number) => v.toLocaleString('ru-RU') + ' сум';
    const formatDate = (d: string) => new Date(d).toLocaleDateString('ru-RU');

    const dataText = `
ДАННЫЕ СТРАНИЦЫ «РЕАНИМАЦИЯ КЛИЕНТОВ» (дата генерации: ${new Date().toLocaleDateString('ru-RU')})

=== СВОДКА ===
Всего клиентов на реанимации: ${totalClients}
  - Перестали покупать (CHURNED, 60+ дней): ${churned.length}
  - Разовые (ONE_TIME_LOST, 30+ дней): ${onceAndGone.length}
  - Засыпающие (SLEEPING, 30-60 дней): ${sleeping.length}
Клиентов с долгом: ${withDebt.length} — общий долг: ${formatMoney(totalDebt)}
Суммарная выручка (историческая): ${formatMoney(totalRevenueLost)}
Средний простой без покупки: ${avgDaysSince} дней

=== ТОП-10 ПО ВЫРУЧКЕ (кандидаты на реанимацию) ===
${topByRevenue.map((r, i) => `${i + 1}. ${r.companyName} | менеджер: ${r.managerName} | выручка: ${formatMoney(r.totalRevenue)} | сделок: ${r.closedDealsCount} | без покупки: ${r.daysSinceLastPurchase ?? '?'} дн. | долг: ${formatMoney(r.currentDebt)} | статус: ${r.status}`).join('\n')}

=== ТОП-10 ПО ДОЛГУ ===
${topByDebt.length > 0 ? topByDebt.map((r, i) => `${i + 1}. ${r.companyName} | долг: ${formatMoney(r.currentDebt)} | менеджер: ${r.managerName} | без покупки: ${r.daysSinceLastPurchase ?? '?'} дн.`).join('\n') : 'Нет клиентов с долгом'}

=== ТОП-10 САМЫХ ДОЛГО НЕАКТИВНЫХ ===
${longestInactive.map((r, i) => `${i + 1}. ${r.companyName} | без покупки: ${r.daysSinceLastPurchase ?? '?'} дн. (последняя: ${formatDate(r.lastPurchaseAt)}) | выручка: ${formatMoney(r.totalRevenue)} | менеджер: ${r.managerName}`).join('\n')}

=== РАЗБИВКА ПО МЕНЕДЖЕРАМ ===
${managerStats.map((m) => `${m.name}: клиентов на реанимации: ${m.count}, суммарная их выручка: ${formatMoney(m.revenue)}, долг: ${formatMoney(m.debt)}`).join('\n')}
`.trim();

    const prompt = `Ты — аналитик CRM-системы для компании, торгующей ламинатом и строительными материалами. Тебе предоставлены данные страницы «Реанимация клиентов» — это клиенты, которые перестали покупать или купили лишь раз и пропали.

${dataText}

Составь подробный аналитический отчёт на русском языке. Включи:
1. **Общая картина** — кратко опиши масштаб проблемы (деньги, клиенты, менеджеры)
2. **Деньги «застрявшие» в пассивных клиентах** — оцени потенциал возврата, выдели ключевые риски по долгам
3. **Анализ по категориям** — что отличает «разовых» от «переставших покупать», на кого делать ставку
4. **Приоритетные клиенты для звонка** — назови конкретные компании из топа (используй реальные имена из данных), объясни почему именно они
5. **Анализ по менеджерам** — у кого больше всего спящих клиентов, кто несёт наибольшую потенциальную ответственность
6. **Конкретные рекомендации** — 5-7 actionable шагов для реанимации, с указанием приоритетов
7. **Риски** — что будет, если ничего не предпринять

Пиши структурированно с заголовками markdown. Будь конкретен — используй числа и имена из данных.`;

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    const message = await stream.finalMessage();
    const content = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const report = await prisma.aiReport.upsert({
      where: { pageKey: PAGE_KEY },
      create: {
        pageKey: PAGE_KEY,
        content,
        generatedBy: userId,
        generatedAt: new Date(),
      },
      update: {
        content,
        generatedBy: userId,
        generatedAt: new Date(),
      },
      include: { author: { select: { fullName: true } } },
    });

    res.json({
      id: report.id,
      content: report.content,
      generatedBy: report.author.fullName,
      generatedAt: report.generatedAt.toISOString(),
    });
  }),
);

export { router as reanimationRoutes };
