import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { config } from './lib/config';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/authenticate';
import { authorize } from './middleware/authorize';
import { requestContextMiddleware } from './middleware/requestContext';
import prisma from './lib/prisma';

import authRoutes from './modules/auth/auth.routes';
import supabaseAuthRoutes from './modules/supabase-auth/supabase-auth.routes';
import siteCmsRoutes from './modules/site-cms/site-cms.routes';
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
import { reanimationRoutes } from './modules/analytics/reanimation.routes';
import { deadProductsRoutes } from './modules/analytics/dead-products.routes';
import { laminationKgUsageRoutes } from './modules/analytics/lamination-kg-usage.routes';
import { paymentOverdueRoutes } from './modules/analytics/payment-overdue.routes';
import { abcXyzRoutes } from './modules/analytics/abcXyz.routes';
import { cohortsRoutes } from './modules/analytics/cohorts.routes';
import { noteAuditRoutes } from './modules/analytics/note-audit.routes';
import { financeRoutes } from './modules/finance/finance.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import conversationsRoutes from './modules/conversations/conversations.routes';
import presenceRoutes from './modules/conversations/presence.routes';
import activityTrackingRoutes from './modules/activity-tracking/activity-tracking.routes';
import expensesRoutes from './modules/expenses/expenses.routes';
import attendanceRoutes from './modules/attendance/attendance.routes';
import timepayRoutes from './modules/timepay/timepay.routes';
import tasksRoutes from './modules/tasks/tasks.routes';
import settingsRoutes from './modules/settings/settings.routes';
import pushRoutes from './modules/push/push.routes';
import telegramRoutes from './modules/telegram/telegram.routes';
import telegramWebhookRoutes from './modules/telegram/telegram-webhook.routes';
import telegramMiniAppRoutes from './modules/telegram/telegram-miniapp.routes';
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
import blockingEventsRoutes from './modules/foreign-trade/blocking-events.routes';
import exchangeRatesRoutes from './modules/foreign-trade/exchange-rates.routes';
import vedMapRoutes from './modules/foreign-trade/ved-map.routes';
import workerReviewsRoutes from './modules/worker-reviews/worker-reviews.routes';
import telephonyRoutes from './modules/telephony/telephony.routes';
import companiesRoutes from './modules/companies/companies.routes';
import dbBackupRoutes, { internalBackupRoutes } from './modules/backup/db-backup.routes';
import './modules/telegram/telegram.customer-bot.service';
import './modules/internal/dailyClosedDeals.scheduler';
import './modules/timepay/timepay.scheduler';
import './modules/backup/db-backup.scheduler';
import './modules/notes-board/notes-board-reminders.scheduler';
import './modules/foreign-trade/exchange-rates.scheduler';

const app = express();

// За обратным прокси (Render): доверяем X-Forwarded-For, иначе req.ip = адрес прокси, а не клиента
app.set('trust proxy', 1);

/**
 * Мини-аппа клиентского бота (магазин). Отдаётся до общего helmet: Telegram открывает её в iframe,
 * поэтому здесь нужен свой CSP (frame-ancestors telegram) и отключённый X-Frame-Options.
 */
app.use(
  '/miniapp',
  helmet({
    frameguard: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ['https://web.telegram.org', 'https://*.web.telegram.org', 'https://telegram.org'],
        baseUri: ["'self'"],
      },
    },
  }),
  express.static(path.join(process.cwd(), 'public', 'miniapp'), {
    // index.html всегда свежий, статика версионируется query-параметром в разметке
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      fontSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));
/** Мини-апп раздаётся самим бэкендом (или своим доменом) — эти origin'ы всегда разрешены. */
const ownOrigins = [config.telegram.backendPublicUrl, config.telegram.miniAppUrl]
  .filter((value): value is string => !!value)
  .map((value) => {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  })
  .filter((value): value is string => !!value);

const allowedOrigins = [...new Set([...config.cors.origins, ...ownOrigins])];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(requestContextMiddleware);

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

/** Только отладочные маршруты под SUPER_ADMIN — не монтировать на весь `/api`, иначе ломаются POST /auth/login и прочее без Bearer. */
app.use('/api/debug', authenticate, authorize('SUPER_ADMIN'), debugRoutes);
app.use('/api/backup', authenticate, authorize('SUPER_ADMIN'), dbBackupRoutes);
app.use('/api/internal/backup', internalBackupRoutes);
app.use('/api/internal/reports', internalReportsRoutes);

// Public routes (no auth)
app.use('/api/public/rate', ratingsRoutes);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/supabase-auth', supabaseAuthRoutes);
app.use('/api/site-cms', siteCmsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/inventory', warehouseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics/intelligence', intelligenceRoutes);
app.use('/api/analytics/history', historyRoutes);
app.use('/api/analytics/reanimation', reanimationRoutes);
app.use('/api/analytics/dead-products', deadProductsRoutes);
app.use('/api/analytics/lamination-kg-usage', laminationKgUsageRoutes);
app.use('/api/analytics/payment-overdue', paymentOverdueRoutes);
app.use('/api/analytics/abc-xyz', abcXyzRoutes);
app.use('/api/analytics/cohorts', cohortsRoutes);
app.use('/api/analytics/note-audit', noteAuditRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/activity', activityTrackingRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/timepay', timepayRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/telegram/miniapp', telegramMiniAppRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/telegram/webhook', telegramWebhookRoutes);
app.use('/api/power-of-attorney', poaRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/ai-assistant', aiAssistantRoutes);
app.use('/api/notes-board', notesBoardRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/import-orders', importOrdersRoutes);
app.use('/api/foreign-trade', cbuRatesRoutes);
app.use('/api/foreign-trade', blockingEventsRoutes);
app.use('/api/foreign-trade', exchangeRatesRoutes);
app.use('/api/foreign-trade', vedMapRoutes);
app.use('/api/worker-reviews', workerReviewsRoutes);
app.use('/api/telephony', telephonyRoutes);

// Error handling (must be last)
app.use(errorHandler);

export default app;
