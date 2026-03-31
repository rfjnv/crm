import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './lib/config';
import { errorHandler } from './middleware/errorHandler';
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

// Health check + Temporary Mass Update for Deals
app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  let updateResult = '';
  try {
    const deals = await prisma.deal.findMany({
      where: { title: { contains: 'Сделка от 25.03.2026' } },
      select: { id: true }
    });
    
    if (deals.length > 0) {
      const ids = deals.map(d => d.id);
      const newDate = new Date('2026-03-24T12:00:00Z');
      const updated = await prisma.deal.updateMany({
        where: { id: { in: ids } },
        data: {
          createdAt: newDate,
          title: 'Сделка от 24.03.2026',
          status: 'READY_FOR_SHIPMENT',
        }
      });
      updateResult = `Updated ${updated.count} deals.`;
    } else {
      updateResult = 'No matching deals found.';
    }
    
    dbOk = true;
    console.log('MASS UPDATE SUCCESS:', updateResult);
  } catch (err) {
    updateResult = `Update ERROR: ${(err as Error).message}`;
    console.log(updateResult);
  }
  const status = dbOk ? 'ok' : 'degraded';
  res.status(200).json({ status, db: dbOk, update: updateResult, timestamp: new Date().toISOString() });
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
