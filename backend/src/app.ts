import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './lib/config';
import { errorHandler } from './middleware/errorHandler';
import prisma from './lib/prisma';

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import profileRoutes from './modules/profile/profile.routes';
import clientsRoutes from './modules/clients/clients.routes';
import dealsRoutes from './modules/deals/deals.routes';
import contractsRoutes from './modules/contracts/contracts.routes';
import warehouseRoutes from './modules/warehouse/warehouse.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { intelligenceRoutes } from './modules/analytics/intelligence.routes';
import { historyRoutes } from './modules/analytics/history.routes';
import { abcXyzRoutes } from './modules/analytics/abcXyz.routes';
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
import debugRoutes from './modules/debug/debug.routes';
import ratingsRoutes from './modules/ratings/ratings.routes';
import aiAssistantRoutes from './modules/ai-assistant/ai-assistant.routes';
import { internalReportsRoutes } from './modules/internal/reports.routes';
import notesBoardRoutes from './modules/notes-board/notes-board.routes';
import suppliersRoutes from './modules/suppliers/suppliers.routes';
import importOrdersRoutes from './modules/import-orders/import-orders.routes';
import cbuRatesRoutes from './modules/foreign-trade/cbu-rates.routes';
import exchangeRatesRoutes from './modules/foreign-trade/exchange-rates.routes';
import './modules/telegram/telegram.customer-bot.service';
import './modules/internal/dailyClosedDeals.scheduler';
import './modules/notes-board/notes-board-reminders.scheduler';
import './modules/foreign-trade/exchange-rates.scheduler';

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

app.use('/api', debugRoutes);
app.use('/api/internal/reports', internalReportsRoutes);

// Public routes (no auth)
app.use('/api/public/rate', ratingsRoutes);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/inventory', warehouseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics/intelligence', intelligenceRoutes);
app.use('/api/analytics/history', historyRoutes);
app.use('/api/analytics/abc-xyz', abcXyzRoutes);
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
app.use('/api/ai-assistant', aiAssistantRoutes);
app.use('/api/notes-board', notesBoardRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/import-orders', importOrdersRoutes);
app.use('/api/foreign-trade', cbuRatesRoutes);
app.use('/api/foreign-trade', exchangeRatesRoutes);

// Error handling (must be last)
app.use(errorHandler);

export default app;
