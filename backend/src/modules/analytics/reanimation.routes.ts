import { Router, Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
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

async function loadListRows(user: AuthUser) {
  const dealFilter = getDealFilter(user);

  const baseRows = await prisma.$queryRaw<BaseClientRow[]>(
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
    WHERE c.is_archived = false
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
    ORDER BY MAX(ds.effective_ts) ASC, c.company_name ASC`,
  );

  if (baseRows.length === 0) return [];

  const clientIds = baseRows.map((row) => row.client_id);

  const [lastDealRows, lastNoteRows, debtRows, productRows] = await Promise.all([
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
        AND d.client_id IN (${Prisma.join(clientIds)})${dealFilter}
      GROUP BY d.client_id, di.product_id, p.name
      ORDER BY d.client_id ASC, SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}) DESC, p.name ASC`,
    ),
  ]);

  const lastDealByClient = new Map(lastDealRows.map((row) => [row.client_id, row]));
  const lastNoteByClient = new Map(lastNoteRows.map((row) => [row.client_id, row]));
  const debtByClient = new Map(debtRows.map((row) => [row.client_id, Number(row.current_debt)]));
  const topProductsByClient = new Map<string, ReturnType<typeof buildProductPreview>[]>();
  const allProductNamesByClient = new Map<string, string[]>();
  const allProductIdsByClient = new Map<string, string[]>();

  for (const row of productRows) {
    const preview = buildProductPreview(row);
    const topList = topProductsByClient.get(row.client_id) ?? [];
    topList.push(preview);
    topProductsByClient.set(row.client_id, topList);

    const names = allProductNamesByClient.get(row.client_id) ?? [];
    names.push(row.product_name);
    allProductNamesByClient.set(row.client_id, names);

    const ids = allProductIdsByClient.get(row.client_id) ?? [];
    ids.push(row.product_id);
    allProductIdsByClient.set(row.client_id, ids);
  }

  const lastDealIds = lastDealRows.map((row) => row.deal_id);
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

async function loadClientSummary(user: AuthUser, clientId: string) {
  const rows = await loadListRows(user);
  return rows.find((row) => row.clientId === clientId) ?? null;
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

export { router as reanimationRoutes };
