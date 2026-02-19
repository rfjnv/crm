import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';

const router = Router();

router.use(authenticate);

// ──── DEBTS ────
router.get(
  '/debts',
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };
    const dealScope = ownerScope(user);

    const [deals, totals] = await Promise.all([
      prisma.deal.findMany({
        where: {
          ...dealScope,
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          status: { notIn: ['CANCELED', 'REJECTED'] },
          isArchived: false,
        },
        include: {
          client: { select: { id: true, companyName: true } },
          manager: { select: { id: true, fullName: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.deal.aggregate({
        where: {
          ...dealScope,
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          status: { notIn: ['CANCELED', 'REJECTED'] },
          isArchived: false,
        },
        _sum: { amount: true, paidAmount: true },
        _count: true,
      }),
    ]);

    const totalAmount = totals._sum.amount ? Number(totals._sum.amount) : 0;
    const totalPaid = totals._sum.paidAmount ? Number(totals._sum.paidAmount) : 0;

    res.json({
      deals,
      totals: {
        count: totals._count,
        totalAmount,
        totalPaid,
        totalDebt: totalAmount - totalPaid,
      },
    });
  }),
);

// ──── CLOSE DAY (POST) ────
router.post(
  '/close-day',
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };

    const canClose = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.permissions.includes('close_deals');
    if (!canClose) {
      throw new AppError(403, 'Недостаточно прав для закрытия дня');
    }

    // Find all CLOSED deals not yet linked to a daily closing
    const unlinkedDeals = await prisma.deal.findMany({
      where: {
        status: 'CLOSED',
        dailyClosingId: null,
      },
      select: { id: true, amount: true },
    });

    if (unlinkedDeals.length === 0) {
      throw new AppError(400, 'Нет сделок для закрытия дня');
    }

    const totalAmount = unlinkedDeals.reduce((sum, d) => sum + Number(d.amount), 0);
    const today = new Date();
    const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const dailyClosing = await prisma.$transaction(async (tx) => {
      const existing = await tx.dailyClosing.findUnique({ where: { date: dateOnly } });

      let closing;
      if (existing) {
        closing = await tx.dailyClosing.update({
          where: { id: existing.id },
          data: {
            totalAmount: { increment: totalAmount },
            closedDealsCount: { increment: unlinkedDeals.length },
          },
        });
      } else {
        closing = await tx.dailyClosing.create({
          data: {
            date: dateOnly,
            totalAmount,
            closedDealsCount: unlinkedDeals.length,
            closedById: user.userId,
          },
        });
      }

      await tx.deal.updateMany({
        where: { id: { in: unlinkedDeals.map((d) => d.id) } },
        data: { dailyClosingId: closing.id },
      });

      return closing;
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'daily_closing',
      entityId: dailyClosing.id,
      after: {
        date: dateOnly.toISOString().slice(0, 10),
        totalAmount,
        closedDealsCount: unlinkedDeals.length,
      },
    });

    const result = await prisma.dailyClosing.findUnique({
      where: { id: dailyClosing.id },
      include: {
        closedBy: { select: { id: true, fullName: true } },
        deals: {
          include: {
            client: { select: { id: true, companyName: true } },
            manager: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    res.json(result);
  }),
);

// ──── DAY CLOSINGS LIST ────
router.get(
  '/day-closings',
  asyncHandler(async (_req: Request, res: Response) => {
    const closings = await prisma.dailyClosing.findMany({
      include: {
        closedBy: { select: { id: true, fullName: true } },
        deals: {
          include: {
            client: { select: { id: true, companyName: true } },
            manager: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    res.json({ closings });
  }),
);

// ──── DAY CLOSING DETAIL (by date) ────
router.get(
  '/day-closing',
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };
    const dealScope = ownerScope(user);

    const dateStr = req.query.date as string | undefined;
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const startOfNextDay = new Date(startOfDay);
    startOfNextDay.setDate(startOfNextDay.getDate() + 1);

    const closedLogs = await prisma.$queryRaw<{ entity_id: string; created_at: Date }[]>(
      Prisma.sql`SELECT DISTINCT ON (entity_id) entity_id, created_at
       FROM audit_logs
       WHERE entity_type = 'deal'
         AND action = 'STATUS_CHANGE'
         AND after->>'status' = 'CLOSED'
         AND created_at >= ${startOfDay} AND created_at < ${startOfNextDay}
       ORDER BY entity_id, created_at DESC`
    );

    const closedDealIds = closedLogs.map((l) => l.entity_id);
    const closedAtMap = new Map(closedLogs.map((l) => [l.entity_id, l.created_at]));

    if (closedDealIds.length === 0) {
      res.json({
        date: startOfDay.toISOString().slice(0, 10),
        summary: { totalDeals: 0, totalAmount: 0, byManager: [] },
        deals: [],
      });
      return;
    }

    const deals = await prisma.deal.findMany({
      where: { id: { in: closedDealIds }, ...dealScope },
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
      },
    });

    let totalAmount = 0;
    const byManagerMap = new Map<string, { managerId: string; fullName: string; count: number; amount: number }>();

    for (const deal of deals) {
      const amt = Number(deal.amount);
      totalAmount += amt;

      const existing = byManagerMap.get(deal.managerId);
      if (existing) {
        existing.count++;
        existing.amount += amt;
      } else {
        byManagerMap.set(deal.managerId, {
          managerId: deal.managerId,
          fullName: deal.manager.fullName,
          count: 1,
          amount: amt,
        });
      }
    }

    res.json({
      date: startOfDay.toISOString().slice(0, 10),
      summary: {
        totalDeals: deals.length,
        totalAmount,
        byManager: [...byManagerMap.values()].sort((a, b) => b.amount - a.amount),
      },
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        client: d.client,
        amount: d.amount.toString(),
        paymentStatus: d.paymentStatus,
        manager: d.manager,
        closedAt: closedAtMap.get(d.id)?.toISOString() || '',
      })),
    });
  }),
);

// ──── CLIENT DEBT DETAIL ────
router.get(
  '/debts/client/:clientId',
  asyncHandler(async (req: Request, res: Response) => {
    const clientId = req.params.clientId as string;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, companyName: true, contactName: true, phone: true },
    });
    if (!client) throw new AppError(404, 'Клиент не найден');

    const deals = await prisma.deal.findMany({
      where: {
        clientId,
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        isArchived: false,
      },
      include: {
        manager: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const payments = await prisma.payment.findMany({
      where: { clientId },
      include: {
        deal: { select: { id: true, title: true } },
        creator: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 50,
    });

    const totalDebt = deals.reduce((sum, d) => sum + (Number(d.amount) - Number(d.paidAmount)), 0);

    // Discipline metrics
    const allClientDeals = await prisma.deal.findMany({
      where: { clientId, status: 'CLOSED', isArchived: false },
      select: { id: true, dueDate: true, paidAmount: true, amount: true },
    });

    let onTimeCount = 0;
    let totalDelayDays = 0;
    let dealsWithDueDate = 0;

    for (const d of allClientDeals) {
      if (!d.dueDate) continue;
      dealsWithDueDate++;
      const lastPayment = await prisma.payment.findFirst({
        where: { dealId: d.id },
        orderBy: { paidAt: 'desc' },
        select: { paidAt: true },
      });
      if (lastPayment) {
        const delayMs = lastPayment.paidAt.getTime() - d.dueDate.getTime();
        const delayDays = delayMs / 86400000;
        if (delayDays <= 0) {
          onTimeCount++;
        } else {
          totalDelayDays += delayDays;
        }
      }
    }

    const onTimeRate = dealsWithDueDate > 0 ? onTimeCount / dealsWithDueDate : 1;
    const avgPaymentDelay = dealsWithDueDate > onTimeCount
      ? totalDelayDays / (dealsWithDueDate - onTimeCount)
      : 0;

    let tag: 'good' | 'pays_late' | 'chronic' = 'good';
    if (onTimeRate < 0.5) tag = 'chronic';
    else if (onTimeRate < 0.8) tag = 'pays_late';

    res.json({
      client,
      deals,
      payments,
      totalDebt,
      discipline: {
        onTimeRate,
        avgPaymentDelay: Math.round(avgPaymentDelay),
        tag,
        totalClosedDeals: allClientDeals.length,
        dealsWithDueDate,
      },
    });
  }),
);

export { router as financeRoutes };
