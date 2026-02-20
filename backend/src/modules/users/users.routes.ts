import { Router, Request, Response } from 'express';
import { usersController } from './users.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createUserDto, updateUserDto } from './users.dto';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';

const router = Router();

router.use(authenticate);

// List users — available to all authenticated users (needed for manager selection)
router.get('/', asyncHandler(usersController.findAll.bind(usersController)));

// ──── KPI ────
router.get(
  '/:id/kpi',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.id as string;
    const period = (req.query.period as string) || 'month';

    const now = new Date();
    let from: Date;
    if (period === 'quarter') {
      from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    } else if (period === 'year') {
      from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }

    const [dealsCreated, dealsCompleted, revenueAgg, shipmentsCount, allCompletedDeals, activityRaw] =
      await Promise.all([
        prisma.deal.count({
          where: { managerId: userId, createdAt: { gte: from } },
        }),
        prisma.deal.count({
          where: { managerId: userId, status: 'CLOSED', updatedAt: { gte: from } },
        }),
        prisma.payment.aggregate({
          where: {
            deal: { managerId: userId },
            paidAt: { gte: from },
          },
          _sum: { amount: true },
        }),
        prisma.shipment.count({
          where: { shippedBy: userId, shippedAt: { gte: from } },
        }),
        prisma.deal.findMany({
          where: { managerId: userId, status: 'CLOSED', updatedAt: { gte: from } },
          select: { createdAt: true, updatedAt: true },
        }),
        prisma.$queryRaw<{ day: string; count: bigint }[]>(
          Prisma.sql`SELECT DATE(created_at) as day, COUNT(*)::bigint as count
           FROM deals
           WHERE manager_id = ${userId} AND created_at >= ${from}
           GROUP BY DATE(created_at)
           ORDER BY day`
        ),
      ]);

    const revenue = revenueAgg._sum.amount ? Number(revenueAgg._sum.amount) : 0;

    let avgDealDays = 0;
    if (allCompletedDeals.length > 0) {
      const totalDays = allCompletedDeals.reduce((sum, d) => {
        const diffMs = d.updatedAt.getTime() - d.createdAt.getTime();
        return sum + diffMs / 86400000;
      }, 0);
      avgDealDays = Math.round(totalDays / allCompletedDeals.length);
    }

    const activityByDay = activityRaw.map((r) => ({
      day: String(r.day),
      count: Number(r.count),
    }));

    res.json({
      dealsCreated,
      dealsCompleted,
      revenue,
      shipmentsCount,
      avgDealDays,
      activityByDay,
    });
  }),
);

// Management routes — ADMIN or SUPER_ADMIN only
router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), validate(createUserDto), asyncHandler(usersController.create.bind(usersController)));
router.patch('/:id', authorize('ADMIN', 'SUPER_ADMIN'), validate(updateUserDto), asyncHandler(usersController.update.bind(usersController)));
router.patch('/:id/activate', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(usersController.activate.bind(usersController)));
router.delete('/:id', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(usersController.deactivate.bind(usersController)));
router.delete('/:id/permanent', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(usersController.deleteUser.bind(usersController)));

export default router;
