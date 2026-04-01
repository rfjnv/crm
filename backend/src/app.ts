import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './lib/config';
import { errorHandler } from './middleware/errorHandler';
import { Prisma } from '@prisma/client';
import prisma from './lib/prisma';

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import clientsRoutes from './modules/clients/clients.routes';
import dealsRoutes from './modules/deals/deals.routes';
import contractsRoutes from './modules/contracts/contracts.routes';
import warehouseRoutes from './modules/warehouse/warehouse.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { intelligenceRoutes } from './modules/analytics/intelligence.routes';
import { historyRoutes } from './modules/analytics/history.routes';
import { financeRoutes } from './modules/finance/finance.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import conversationsRoutes from './modules/conversations/conversations.routes';
import presenceRoutes from './modules/conversations/presence.routes';
import expensesRoutes from './modules/expenses/expenses.routes';
import tasksRoutes from './modules/tasks/tasks.routes';
import settingsRoutes from './modules/settings/settings.routes';
import pushRoutes from './modules/push/push.routes';
import telegramRoutes from './modules/telegram/telegram.routes';
import poaRoutes from './modules/power-of-attorney/power-of-attorney.routes';
import { reviewsRoutes } from './modules/reviews/reviews.routes';
import './modules/telegram/telegram.customer-bot.service';

const app = express();

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
    },
  },
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.cors.origins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Static files (uploaded attachments)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check
app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    console.error('Health check DB error:', (err as Error).message);
  }
  const status = dbOk ? 'ok' : 'degraded';
  res.status(200).json({ status, db: dbOk, timestamp: new Date().toISOString() });
});

// Temporary: Revenue gap diagnostics (remove after fix)
app.get('/api/debug/revenue-gap', async (_req, res) => {
  const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
  const nowTZ = new Date(Date.now() + TASHKENT_OFFSET);
  const y = nowTZ.getUTCFullYear(), mo = nowTZ.getUTCMonth(), d = nowTZ.getUTCDate();
  const startOfToday = new Date(Date.UTC(y, mo, d) - TASHKENT_OFFSET);
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);

  // All deals created yesterday with their items breakdown
  const deals = await prisma.deal.findMany({
    where: { createdAt: { gte: startOfYesterday, lt: startOfToday }, isArchived: false },
    include: {
      client: { select: { companyName: true } },
      items: { include: { product: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Also deals where deal_date is yesterday (not created_at)
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

  // Dashboard formula revenue for yesterday
  const [revYestRow] = await prisma.$queryRaw<{total: string}[]>(Prisma.sql`
    SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
    FROM deal_items di JOIN deals d ON d.id = di.deal_id
    WHERE d.status NOT IN ('CANCELED','REJECTED') AND d.is_archived = false
      AND COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
      AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}
  `);

  const [revTodayRow] = await prisma.$queryRaw<{total: string}[]>(Prisma.sql`
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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/inventory', warehouseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics/intelligence', intelligenceRoutes);
app.use('/api/analytics/history', historyRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/power-of-attorney', poaRoutes);
app.use('/api/reviews', reviewsRoutes);

// Error handling (must be last)
app.use(errorHandler);

export default app;
