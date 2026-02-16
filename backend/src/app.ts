import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import { financeRoutes } from './modules/finance/finance.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import conversationsRoutes from './modules/conversations/conversations.routes';
import presenceRoutes from './modules/conversations/presence.routes';
import expensesRoutes from './modules/expenses/expenses.routes';
import tasksRoutes from './modules/tasks/tasks.routes';

const app = express();

// Security
app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    // DB unreachable
  }
  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({ status, db: dbOk, timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/inventory', warehouseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/tasks', tasksRoutes);

// Error handling (must be last)
app.use(errorHandler);

export default app;
