import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';

const router = Router();

router.use(authenticate);

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

export { router as adminRoutes };
