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

      // Unlink daily closings
      await tx.deal.updateMany({ data: { dailyClosingId: null } });
      await tx.dailyClosing.deleteMany();

      // Deals → Contracts → Clients → Products
      await tx.deal.deleteMany();
      await tx.contract.deleteMany();
      await tx.client.deleteMany();
      await tx.product.deleteMany();

      await tx.auditLog.deleteMany();
    });

    // One final audit entry
    await prisma.auditLog.create({
      data: {
        userId: req.user!.userId,
        action: 'DELETE',
        entityType: 'system',
        after: { operation: 'purge_all_data' },
      },
    });

    res.json({ success: true, message: 'Все данные очищены' });
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
