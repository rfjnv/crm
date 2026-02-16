import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { createExpenseDto } from './expenses.dto';

const router = Router();

router.use(authenticate);

// ──── LIST ────
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, category } = req.query;

    const where: Record<string, unknown> = {};
    if (from || to) {
      where.date = {};
      if (from) (where.date as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.date as Record<string, unknown>).lte = new Date(to as string);
    }
    if (category) where.category = category as string;

    const expenses = await prisma.expense.findMany({
      where,
      include: { creator: { select: { id: true, fullName: true } } },
      orderBy: { date: 'desc' },
    });

    const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    res.json({ expenses, total });
  }),
);

// ──── CREATE ────
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role as Role;
    if (!['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(role)) {
      throw new AppError(403, 'Недостаточно прав');
    }

    const data = createExpenseDto.parse(req.body);

    const expense = await prisma.expense.create({
      data: {
        date: new Date(data.date),
        category: data.category,
        amount: data.amount,
        note: data.note,
        createdBy: req.user!.userId,
      },
      include: { creator: { select: { id: true, fullName: true } } },
    });

    res.status(201).json(expense);
  }),
);

// ──── DELETE ────
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role as Role;
    if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
      throw new AppError(403, 'Только администратор может удалять расходы');
    }

    const id = req.params.id as string;
    await prisma.expense.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

export default router;
