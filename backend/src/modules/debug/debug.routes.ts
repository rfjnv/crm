import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';

const router = Router();

router.get('/debug/test', (_req, res) => {
  res.json({ ok: true });
});

router.get('/debug/revenue-diff', async (_req, res) => {
  const rows = await prisma.$queryRaw<
    { id: string; deal_amount: string; line_sum: string; diff: string }[]
  >(Prisma.sql`
    SELECT
      d.id,
      d.amount AS deal_amount,
      COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0) AS line_sum,
      d.amount - COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0) AS diff
    FROM deals d
    LEFT JOIN deal_items di ON di.deal_id = d.id
    WHERE DATE((COALESCE(di.deal_date, d.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent') = DATE '2026-03-31'
    GROUP BY d.id, d.amount
    HAVING d.amount <> COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)
    ORDER BY ABS(d.amount - COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)) DESC
  `);

  res.json(rows);
});

router.get('/debug/revenue-gap', async (_req, res) => {
  const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
  const nowTZ = new Date(Date.now() + TASHKENT_OFFSET);
  const y = nowTZ.getUTCFullYear(), mo = nowTZ.getUTCMonth(), d = nowTZ.getUTCDate();
  const startOfToday = new Date(Date.UTC(y, mo, d) - TASHKENT_OFFSET);
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);

  const deals = await prisma.deal.findMany({
    where: { createdAt: { gte: startOfYesterday, lt: startOfToday }, isArchived: false },
    include: {
      client: { select: { companyName: true } },
      items: { include: { product: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const dealsByItemDate = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT DISTINCT d.id, d.title, d.status, d.amount::text, d.is_archived, d.created_at,
                    c.company_name
    FROM deals d
    JOIN deal_items di ON di.deal_id = d.id
    JOIN clients c ON c.id = d.client_id
    WHERE di.deal_date >= ${startOfYesterday} AND di.deal_date < ${startOfToday}
      AND d.created_at < ${startOfYesterday}
      AND d.status NOT IN ('CANCELED','REJECTED')
      AND d.is_archived = false
  `);

  const [revYestRow] = await prisma.$queryRaw<{ total: string }[]>(Prisma.sql`
    SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
    FROM deal_items di JOIN deals d ON d.id = di.deal_id
    WHERE d.status NOT IN ('CANCELED','REJECTED') AND d.is_archived = false
      AND COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
      AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}
  `);

  const [revTodayRow] = await prisma.$queryRaw<{ total: string }[]>(Prisma.sql`
    SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
    FROM deal_items di JOIN deals d ON d.id = di.deal_id
    WHERE d.status NOT IN ('CANCELED','REJECTED') AND d.is_archived = false
      AND COALESCE(di.deal_date, d.created_at) >= ${startOfToday}
      AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}
  `);

  const dealsSummary = deals.map(deal => {
    const itemsRevenue = deal.items.reduce((sum, item) => {
      const lt = item.lineTotal != null ? Number(item.lineTotal) :
                 (item.requestedQty != null && item.price != null
                   ? Number(item.requestedQty) * Number(item.price) : 0);
      return sum + lt;
    }, 0);
    return {
      id: deal.id, title: deal.title, status: deal.status,
      dealAmount: Number(deal.amount),
      itemsRevenue,
      gap: Number(deal.amount) - itemsRevenue,
      client: deal.client?.companyName,
      createdAt: deal.createdAt,
      items: deal.items.map(i => ({
        product: i.product?.name,
        qty: i.requestedQty != null ? Number(i.requestedQty) : null,
        price: i.price != null ? Number(i.price) : null,
        lineTotal: i.lineTotal != null ? Number(i.lineTotal) : null,
        dealDate: i.dealDate,
        computed: i.lineTotal != null ? Number(i.lineTotal) :
                  (i.requestedQty != null && i.price != null
                    ? Number(i.requestedQty) * Number(i.price) : 0),
      })),
    };
  });

  res.json({
    window: { from: startOfYesterday, to: startOfToday },
    revenueYesterday: Number(revYestRow.total),
    revenueToday: Number(revTodayRow.total),
    dealsCreatedYesterday: dealsSummary,
    dealsWithItemDateYesterday: dealsByItemDate,
    problemDeals: dealsSummary.filter(d => Math.abs(d.gap) > 100 || d.status === 'CANCELED' || d.status === 'REJECTED'),
    zeroRevenueItems: dealsSummary.flatMap(d => d.items.filter(i => i.computed === 0).map(i => ({ ...i, deal: d.title, client: d.client }))),
  });
});

export default router;
