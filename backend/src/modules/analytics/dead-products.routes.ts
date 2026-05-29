import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
} from '../../lib/analytics';
import { sqlInventoryMovementBusinessDate, sqlMovementIsSale } from '../../lib/inventoryAnalytics';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { authorize } from '../../middleware/authorize';

const router = Router();

router.use(authenticate);

const DEFAULT_NO_SALES_DAYS = 90;
const DEFAULT_ZERO_STOCK_DAYS = 30;

export type DeadProductIssue =
  | 'STAGNANT'
  | 'ZERO_STOCK'
  | 'ZERO_LONG'
  | 'NEVER_SOLD'
  | 'NO_SALES';

type ProductMetricsRow = {
  product_id: string;
  name: string;
  sku: string;
  unit: string;
  category: string | null;
  country_of_origin: string | null;
  stock: string;
  min_stock: string;
  purchase_price: string | null;
  sale_price: string | null;
  is_active: boolean;
  created_at: Date;
  lifetime_deals: string;
  lifetime_qty: string;
  lifetime_revenue: string;
  last_sale_at: Date | null;
  last_in_at: Date | null;
  qty_sold_90d: string;
  revenue_90d: string;
};

function parsePositiveInt(raw: unknown, fallback: number, max = 730): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function daysSince(isoOrDate: string | Date | null | undefined): number | null {
  if (!isoOrDate) return null;
  const ms = new Date(isoOrDate).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

function classifyIssues(
  row: ProductMetricsRow,
  noSalesDays: number,
  zeroStockDays: number,
): DeadProductIssue[] {
  const stock = Number(row.stock);
  const lastSaleAt = row.last_sale_at;
  const daysSinceSale = daysSince(lastSaleAt);
  const lastInAt = row.last_in_at;
  const daysAtZero =
    stock <= 0
      ? daysSince(lastInAt ?? row.created_at)
      : null;

  const issues: DeadProductIssue[] = [];

  if (!lastSaleAt) {
    issues.push('NEVER_SOLD');
  } else if (daysSinceSale !== null && daysSinceSale >= noSalesDays) {
    issues.push('NO_SALES');
  }

  if (stock <= 0) {
    issues.push('ZERO_STOCK');
    if (daysAtZero !== null && daysAtZero >= zeroStockDays) {
      issues.push('ZERO_LONG');
    }
  } else if (daysSinceSale === null || daysSinceSale >= noSalesDays) {
    issues.push('STAGNANT');
  }

  return issues;
}

function mapRow(
  row: ProductMetricsRow,
  noSalesDays: number,
  zeroStockDays: number,
) {
  const stock = Number(row.stock);
  const minStock = Number(row.min_stock);
  const purchasePrice = row.purchase_price != null ? Number(row.purchase_price) : null;
  const salePrice = row.sale_price != null ? Number(row.sale_price) : null;
  const frozenValue =
    purchasePrice != null && stock > 0 ? Math.round(stock * purchasePrice * 100) / 100 : 0;

  const issues = classifyIssues(row, noSalesDays, zeroStockDays);
  const daysSinceLastSale = daysSince(row.last_sale_at);
  const daysAtZero =
    stock <= 0 ? daysSince(row.last_in_at ?? row.created_at) : null;

  return {
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    unit: row.unit,
    category: row.category,
    countryOfOrigin: row.country_of_origin,
    stock,
    minStock,
    purchasePrice,
    salePrice,
    isActive: row.is_active,
    lifetimeDeals: Number(row.lifetime_deals),
    lifetimeQty: Number(row.lifetime_qty),
    lifetimeRevenue: Number(row.lifetime_revenue),
    lastSaleAt: row.last_sale_at ? row.last_sale_at.toISOString() : null,
    lastInAt: row.last_in_at ? row.last_in_at.toISOString() : null,
    daysSinceLastSale,
    daysAtZero,
    qtySold90d: Number(row.qty_sold_90d),
    revenue90d: Number(row.revenue_90d),
    frozenValue,
    issues,
    isDead: issues.length > 0,
  };
}

async function loadProductMetrics(): Promise<ProductMetricsRow[]> {
  const businessDate = sqlInventoryMovementBusinessDate('m', 'd');
  const saleMovement = sqlMovementIsSale('m');

  return prisma.$queryRaw<ProductMetricsRow[]>(Prisma.sql`
    WITH sales_lifetime AS (
      SELECT
        di.product_id,
        COUNT(DISTINCT di.deal_id)::text AS lifetime_deals,
        COALESCE(SUM(di.requested_qty::numeric), 0)::text AS lifetime_qty,
        COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text AS lifetime_revenue,
        MAX(${SQL_EFFECTIVE_REVENUE_ITEM_TS}) AS last_sale_at
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND COALESCE(di.requested_qty::numeric, 0) > 0
      GROUP BY di.product_id
    ),
    sales_90d AS (
      SELECT
        di.product_id,
        COALESCE(SUM(di.requested_qty::numeric), 0)::text AS qty_sold_90d,
        COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text AS revenue_90d
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND COALESCE(di.requested_qty::numeric, 0) > 0
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= NOW() - INTERVAL '90 days'
      GROUP BY di.product_id
    ),
    movement_agg AS (
      SELECT
        m.product_id,
        MAX(CASE WHEN m.type = 'IN' THEN ${businessDate} END) AS last_in_at,
        MAX(CASE WHEN ${saleMovement} THEN ${businessDate} END) AS last_sale_movement_at
      FROM inventory_movements m
      LEFT JOIN deals d ON d.id = m.deal_id
      GROUP BY m.product_id
    )
    SELECT
      p.id AS product_id,
      p.name,
      p.sku,
      p.unit,
      p.category,
      p.country_of_origin,
      p.stock::text AS stock,
      p.min_stock::text AS min_stock,
      p.purchase_price::text AS purchase_price,
      p.sale_price::text AS sale_price,
      p.is_active,
      p.created_at,
      COALESCE(sl.lifetime_deals, '0') AS lifetime_deals,
      COALESCE(sl.lifetime_qty, '0') AS lifetime_qty,
      COALESCE(sl.lifetime_revenue, '0') AS lifetime_revenue,
      sl.last_sale_at,
      ma.last_in_at,
      COALESCE(s90.qty_sold_90d, '0') AS qty_sold_90d,
      COALESCE(s90.revenue_90d, '0') AS revenue_90d
    FROM products p
    LEFT JOIN sales_lifetime sl ON sl.product_id = p.id
    LEFT JOIN sales_90d s90 ON s90.product_id = p.id
    LEFT JOIN movement_agg ma ON ma.product_id = p.id
    ORDER BY p.name ASC
  `);
}

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'),
  asyncHandler(async (req: Request, res: Response) => {
    const noSalesDays = parsePositiveInt(req.query.noSalesDays, DEFAULT_NO_SALES_DAYS);
    const zeroStockDays = parsePositiveInt(req.query.zeroStockDays, DEFAULT_ZERO_STOCK_DAYS);

    const rawRows = await loadProductMetrics();
    const products = rawRows.map((r) => mapRow(r, noSalesDays, zeroStockDays));

    const categories = [...new Set(products.map((p) => p.category).filter(Boolean))] as string[];
    categories.sort((a, b) => a.localeCompare(b, 'ru'));

    const countries = [...new Set(products.map((p) => p.countryOfOrigin).filter(Boolean))] as string[];
    countries.sort((a, b) => a.localeCompare(b, 'ru'));

    const deadOnly = products.filter((p) => p.isDead);
    const issueCounts: Record<DeadProductIssue, number> = {
      STAGNANT: 0,
      ZERO_STOCK: 0,
      ZERO_LONG: 0,
      NEVER_SOLD: 0,
      NO_SALES: 0,
    };
    for (const p of products) {
      for (const issue of p.issues) {
        issueCounts[issue] += 1;
      }
    }

    const frozenCapital = products.reduce((s, p) => s + p.frozenValue, 0);

    res.json({
      thresholds: { noSalesDays, zeroStockDays },
      summary: {
        totalActive: products.filter((p) => p.isActive).length,
        deadCount: deadOnly.length,
        zeroStockCount: products.filter((p) => p.stock <= 0).length,
        stagnantCount: issueCounts.STAGNANT,
        frozenCapital: Math.round(frozenCapital * 100) / 100,
        issueCounts,
      },
      categories,
      countries,
      products,
    });
  }),
);

export { router as deadProductsRoutes };
