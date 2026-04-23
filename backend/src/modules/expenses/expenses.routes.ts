import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize, requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { createExpenseDto, rejectExpenseDto } from './expenses.dto';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';
import { moneyService } from '../foreign-trade/money.service';
import { recalcImportOrderUzs } from '../import-orders/import-orders.service';

const router = Router();

router.use(authenticate);

const expenseInclude = {
  creator: { select: { id: true, fullName: true } },
  approver: { select: { id: true, fullName: true } },
  importOrder: { select: { id: true, number: true, currency: true } },
};

const EXPENSES_PAGE_URL = '/finance/expenses';

// ──── LIST ────
router.get(
  '/',
  requirePermission('manage_expenses'),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, category, status } = req.query;

    const where: Record<string, unknown> = {};
    if (from || to) {
      where.date = {};
      if (from) (where.date as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.date as Record<string, unknown>).lte = new Date(to as string);
    }
    if (category) where.category = category as string;
    if (status) where.status = status as string;

    const expenses = await prisma.expense.findMany({
      where,
      include: expenseInclude,
      orderBy: { date: 'desc' },
    });

    const total = expenses
      .filter((e) => e.status === 'APPROVED')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    res.json({ expenses, total });
  }),
);

// ──── CREATE ────
router.post(
  '/',
  requirePermission('manage_expenses'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = createExpenseDto.parse(req.body);
    const userRole = req.user!.role;
    const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';

    // MVP-4: при привязке к импорт-заказу проверяем, что он существует
    if (data.importOrderId) {
      const exists = await prisma.importOrder.findUnique({
        where: { id: data.importOrderId },
        select: { id: true },
      });
      if (!exists) throw new AppError(404, 'Импорт-заказ не найден');
    }

    // MVP-4: конверсия в UZS по курсу ЦБ на дату расхода
    const conv = await moneyService.toUzs(data.amount, data.currency, data.date);
    const amountUzs = conv ? conv.amountUzs : null;
    const exchangeRate = conv ? conv.rate : null;

    const expense = await prisma.expense.create({
      data: {
        date: new Date(data.date),
        category: data.category,
        amount: data.amount,
        note: data.note,
        method: data.method,
        currency: data.currency,
        exchangeRate,
        amountUzs,
        importOrderId: data.importOrderId ?? null,
        createdBy: req.user!.userId,
        status: isAdmin ? 'APPROVED' : 'PENDING',
        approvedBy: isAdmin ? req.user!.userId : undefined,
        approvedAt: isAdmin ? new Date() : undefined,
      },
      include: expenseInclude,
    });

    // Если сразу APPROVED и привязан к заказу — пересчитываем landed cost
    if (isAdmin && expense.importOrderId) {
      await recalcImportOrderUzs(expense.importOrderId);
    }

    // Notify admins about pending expense
    if (!isAdmin) {
      const payload = {
        title: 'Новая заявка на расход (требует одобрения)',
        body: `${expense.creator?.fullName} отправил(а) заявку: ${data.category} — ${Number(data.amount).toLocaleString('ru-RU')} сум. Проверьте и примите решение.`,
        url: EXPENSES_PAGE_URL,
        severity: 'WARNING' as const,
      };
      pushService.sendPushToRoles(['ADMIN', 'SUPER_ADMIN'], payload).catch(() => {});
      telegramService.sendToRoles(['ADMIN', 'SUPER_ADMIN'], payload).catch(() => {});
    }

    res.status(201).json(expense);
  }),
);

// ──── APPROVE ────
router.patch(
  '/:id/approve',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const expenseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) throw new AppError(404, 'Расход не найден');
    if (expense.status !== 'PENDING') throw new AppError(400, 'Расход не на рассмотрении');

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        status: 'APPROVED',
        approvedBy: req.user!.userId,
        approvedAt: new Date(),
      },
      include: expenseInclude,
    });

    if (updated.importOrderId) {
      await recalcImportOrderUzs(updated.importOrderId);
    }

    // Notify creator
    const payload = {
      title: 'Расход одобрен',
      body: `Ваша заявка "${expense.category}" на ${Number(expense.amount).toLocaleString('ru-RU')} сум одобрена администратором.`,
      url: EXPENSES_PAGE_URL,
      severity: 'INFO' as const,
    };
    pushService.sendPushToUser(expense.createdBy, payload).catch(() => {});
    telegramService.sendToUser(expense.createdBy, payload).catch(() => {});

    res.json(updated);
  }),
);

// ──── REJECT ────
router.patch(
  '/:id/reject',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = rejectExpenseDto.parse(req.body);

    const expenseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) throw new AppError(404, 'Расход не найден');
    if (expense.status !== 'PENDING') throw new AppError(400, 'Расход не на рассмотрении');

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        status: 'REJECTED',
        approvedBy: req.user!.userId,
        approvedAt: new Date(),
        rejectedReason: reason,
      },
      include: expenseInclude,
    });

    // REJECTED расход не влияет на overhead, но на всякий случай пересчитаем
    // (на случай смены статуса APPROVED → REJECTED, хотя тут было PENDING)
    if (updated.importOrderId) {
      await recalcImportOrderUzs(updated.importOrderId);
    }

    // Notify creator (URGENT)
    const payload = {
      title: 'Расход отклонён',
      body: `Ваша заявка "${expense.category}" отклонена. Причина: ${reason}`,
      url: EXPENSES_PAGE_URL,
      severity: 'URGENT' as const,
    };
    pushService.sendPushToUser(expense.createdBy, payload).catch(() => {});
    telegramService.sendToUser(expense.createdBy, payload).catch(() => {});

    res.json(updated);
  }),
);

// ──── DELETE ────
router.delete(
  '/:id',
  requirePermission('manage_expenses'),
  asyncHandler(async (req: Request, res: Response) => {
    const expenseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) throw new AppError(404, 'Расход не найден');

    const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'SUPER_ADMIN';
    const isOwner = expense.createdBy === req.user!.userId;

    if (!isAdmin && (!isOwner || expense.status !== 'PENDING')) {
      throw new AppError(403, 'Недостаточно прав для удаления');
    }

    const linkedOrderId = expense.importOrderId;
    await prisma.expense.delete({ where: { id: expenseId } });

    if (linkedOrderId) {
      await recalcImportOrderUzs(linkedOrderId);
    }

    res.json({ ok: true });
  }),
);

export default router;
