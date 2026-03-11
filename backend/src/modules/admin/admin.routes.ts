import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { superOverrideDealDto, superDeleteDealDto } from '../deals/deals.dto';
import { dealsService } from '../deals/deals.service';
import { AuthUser } from '../../lib/scope';
import { comparePassword } from '../../lib/password';
import { auditLog } from '../../lib/logger';

const router = Router();

router.use(authenticate);

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

// ──── PURGE ALL BUSINESS DATA ────
router.post(
  '/purge-data',
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role as Role;

    if (role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только SUPER_ADMIN может очищать данные');
    }

    // Safety: require confirmation text + password
    const { confirmText, password } = req.body || {};
    if (confirmText !== 'DELETE ALL DATA') {
      throw new AppError(400, 'Для подтверждения введите "DELETE ALL DATA"');
    }
    if (!password) {
      throw new AppError(400, 'Необходимо ввести пароль для подтверждения');
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw new AppError(401, 'Пользователь не найден');

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      throw new AppError(403, 'Неверный пароль');
    }

    // Audit BEFORE deletion so it's recorded even if something goes wrong
    await auditLog({
      userId: req.user!.userId,
      action: 'DELETE',
      entityType: 'system',
      after: { operation: 'purge_all_data', confirmedAt: new Date().toISOString() },
    });

    await prisma.$transaction(async (tx) => {
      // Task-related
      await tx.taskAttachment.deleteMany();
      await tx.task.deleteMany();

      // Expenses
      await tx.expense.deleteMany();

      // Chat
      await tx.messageAttachment.deleteMany();
      await tx.conversationRead.deleteMany();
      await tx.message.deleteMany();

      // Notifications
      await tx.notification.deleteMany();
      await tx.notificationBatch.deleteMany();

      // Deal children
      await tx.dealComment.deleteMany();
      await tx.dealItem.deleteMany();
      await tx.shipment.deleteMany();
      await tx.payment.deleteMany();
      await tx.inventoryMovement.deleteMany();

      // Deals -> Contracts -> Clients -> Products
      await tx.deal.deleteMany();
      await tx.contractAttachment.deleteMany();
      await tx.contract.deleteMany();
      await tx.client.deleteMany();
      await tx.product.deleteMany();
    });

    res.json({ success: true, message: 'Все данные очищены' });
  }),
);

// ──── CLEANUP BUSINESS DATA (preserve clients, products, users) ────
router.post(
  '/cleanup-data',
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role as Role;

    if (role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только SUPER_ADMIN может очищать данные');
    }

    // Safety: require confirmation text + password
    const { confirmText, password } = req.body || {};
    if (confirmText !== 'CLEANUP DATA') {
      throw new AppError(400, 'Для подтверждения введите "CLEANUP DATA"');
    }
    if (!password) {
      throw new AppError(400, 'Необходимо ввести пароль для подтверждения');
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw new AppError(401, 'Пользователь не найден');

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      throw new AppError(403, 'Неверный пароль');
    }

    await auditLog({
      userId: req.user!.userId,
      action: 'DELETE',
      entityType: 'system',
      after: { operation: 'cleanup_business_data', confirmedAt: new Date().toISOString() },
    });

    const counts: Record<string, number> = {};

    await prisma.$transaction(async (tx) => {
      counts.taskAttachments = (await tx.taskAttachment.deleteMany()).count;
      counts.tasks = (await tx.task.deleteMany()).count;

      counts.expenses = (await tx.expense.deleteMany()).count;

      counts.messageAttachments = (await tx.messageAttachment.deleteMany()).count;
      counts.conversationReads = (await tx.conversationRead.deleteMany()).count;
      counts.messages = (await tx.message.deleteMany()).count;

      counts.notifications = (await tx.notification.deleteMany()).count;
      counts.notificationBatches = (await tx.notificationBatch.deleteMany()).count;

      counts.dealComments = (await tx.dealComment.deleteMany()).count;
      counts.dealItems = (await tx.dealItem.deleteMany()).count;
      counts.shipments = (await tx.shipment.deleteMany()).count;
      counts.payments = (await tx.payment.deleteMany()).count;
      counts.inventoryMovements = (await tx.inventoryMovement.deleteMany()).count;

      counts.deals = (await tx.deal.deleteMany()).count;
      counts.contracts = (await tx.contract.deleteMany()).count;

      counts.auditLogs = (await tx.auditLog.deleteMany()).count;
    });

    const preserved = {
      clients: await prisma.client.count(),
      products: await prisma.product.count(),
      users: await prisma.user.count(),
    };

    res.json({ success: true, message: 'Бизнес-данные очищены', deleted: counts, preserved });
  }),
);

// ──── SUPER_ADMIN Deal Override ────
router.patch(
  '/deals/:id/override',
  requirePermission('super_deal_override'),
  validate(superOverrideDealDto),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dealsService.overrideUpdate(req.params.id as string, req.body, getUser(req));
    res.json(result);
  }),
);

// ──── SUPER_ADMIN Hard Delete Deal ────
router.delete(
  '/deals/:id',
  requirePermission('delete_any_deal'),
  validate(superDeleteDealDto),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dealsService.hardDelete(req.params.id as string, req.body.reason, getUser(req));
    res.json(result);
  }),
);

// ──── SUPER_ADMIN Audit History ────
router.get(
  '/deals/:id/audit',
  requirePermission('view_audit_history'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dealsService.getAuditHistory(req.params.id as string);
    res.json(result);
  }),
);

export { router as adminRoutes };
