import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';

const router = Router();

router.use(authenticate);

// ──── КАССА (Payments Report) ────
router.get(
  '/cashbox',
  authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'),
  asyncHandler(async (req: Request, res: Response) => {
    const period = req.query.period as string || 'day';
    const managerId = req.query.managerId as string | undefined;
    const clientId = req.query.clientId as string | undefined;
    const method = req.query.method as string | undefined;
    const paymentStatus = req.query.paymentStatus as string | undefined;

    // Calculate date range
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let fromDate: Date;

    if (period === 'week') {
      fromDate = new Date(startOfDay);
      fromDate.setDate(fromDate.getDate() - 7);
    } else if (period === 'month') {
      fromDate = new Date(startOfDay);
      fromDate.setMonth(fromDate.getMonth() - 1);
    } else {
      fromDate = startOfDay;
    }

    // Build where clause for payments
    const where: Prisma.PaymentWhereInput = {
      paidAt: { gte: fromDate },
    };

    if (managerId) {
      where.deal = { managerId };
    }
    if (clientId) {
      where.clientId = clientId;
    }
    if (method) {
      where.method = method;
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        deal: {
          select: {
            id: true,
            title: true,
            managerId: true,
            manager: { select: { id: true, fullName: true } },
            paymentStatus: true,
          },
        },
        client: { select: { id: true, companyName: true } },
        creator: { select: { id: true, fullName: true } },
        receivedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
    });

    // Filter by deal paymentStatus if specified
    let filteredPayments = payments;
    if (paymentStatus === 'PAID' || paymentStatus === 'PARTIAL') {
      filteredPayments = payments.filter((p) => p.deal?.paymentStatus === paymentStatus);
    }

    // Calculate totals
    const totalAmount = filteredPayments.reduce((s, p) => s + Number(p.amount), 0);

    // Breakdown by method
    const byMethod: Record<string, number> = {};
    for (const p of filteredPayments) {
      const key = p.method || 'Не указан';
      byMethod[key] = (byMethod[key] || 0) + Number(p.amount);
    }

    // Breakdown by day
    const byDay: Record<string, number> = {};
    for (const p of filteredPayments) {
      const day = p.paidAt.toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + Number(p.amount);
    }

    // Daily total (today)
    const todayStr = startOfDay.toISOString().slice(0, 10);
    const todayTotal = byDay[todayStr] || 0;

    res.json({
      payments: filteredPayments.map((p) => ({
        id: p.id,
        dealId: p.dealId,
        dealTitle: p.deal?.title,
        clientId: p.clientId,
        clientName: p.client?.companyName,
        amount: Number(p.amount),
        paidAt: p.paidAt,
        method: p.method,
        note: p.note,
        createdBy: p.creator?.fullName,
        receivedBy: p.receivedBy?.fullName || p.creator?.fullName,
        manager: p.deal?.manager?.fullName,
        dealPaymentStatus: p.deal?.paymentStatus,
      })),
      totals: {
        totalAmount,
        todayTotal,
        count: filteredPayments.length,
      },
      byMethod: Object.entries(byMethod).map(([m, total]) => ({ method: m, total })),
      byDay: Object.entries(byDay)
        .map(([day, total]) => ({ day, total }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      period,
      fromDate: fromDate.toISOString(),
    });
  }),
);

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

    const minDebt = req.query.minDebt ? Number(req.query.minDebt) : undefined;
    const managerId = req.query.managerId as string | undefined;
    const paymentStatus = req.query.paymentStatus as string | undefined;

    const where: Prisma.DealWhereInput = {
      ...dealScope,
      paymentStatus: paymentStatus
        ? { equals: paymentStatus as 'UNPAID' | 'PARTIAL' }
        : { in: ['UNPAID', 'PARTIAL'] },
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    };
    if (managerId) where.managerId = managerId;

    const deals = await prisma.deal.findMany({
      where,
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        payments: {
          select: { paidAt: true },
          orderBy: { paidAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    // Aggregate by client
    const clientMap = new Map<string, {
      clientId: string;
      clientName: string;
      totalDebt: number;
      totalAmount: number;
      totalPaid: number;
      dealsCount: number;
      lastPaymentDate: string | null;
      managers: Map<string, { id: string; fullName: string; count: number }>;
      newestDealDate: string;
      oldestUnpaidDueDate: string | null;
      hasPartial: boolean;
      hasPaid: boolean;
    }>();

    for (const deal of deals) {
      const cid = deal.clientId;
      const debt = Number(deal.amount) - Number(deal.paidAmount);

      if (!clientMap.has(cid)) {
        clientMap.set(cid, {
          clientId: cid,
          clientName: deal.client?.companyName || '',
          totalDebt: 0,
          totalAmount: 0,
          totalPaid: 0,
          dealsCount: 0,
          lastPaymentDate: null,
          managers: new Map(),
          newestDealDate: deal.createdAt.toISOString(),
          oldestUnpaidDueDate: null,
          hasPartial: false,
          hasPaid: false,
        });
      }

      const entry = clientMap.get(cid)!;
      entry.totalDebt += debt;
      entry.totalAmount += Number(deal.amount);
      entry.totalPaid += Number(deal.paidAmount);
      entry.dealsCount++;

      if (deal.paymentStatus === 'PARTIAL') entry.hasPartial = true;
      if (Number(deal.paidAmount) > 0) entry.hasPaid = true;

      const pDate = deal.payments?.[0]?.paidAt;
      if (pDate) {
        const ps = pDate.toISOString();
        if (!entry.lastPaymentDate || ps > entry.lastPaymentDate) {
          entry.lastPaymentDate = ps;
        }
      }

      const mgr = deal.manager;
      if (mgr) {
        const existing = entry.managers.get(mgr.id);
        if (existing) existing.count++;
        else entry.managers.set(mgr.id, { id: mgr.id, fullName: mgr.fullName, count: 1 });
      }

      const dealDate = deal.createdAt.toISOString();
      if (dealDate > entry.newestDealDate) entry.newestDealDate = dealDate;

      if (deal.dueDate) {
        const ds = deal.dueDate.toISOString();
        if (!entry.oldestUnpaidDueDate || ds < entry.oldestUnpaidDueDate) {
          entry.oldestUnpaidDueDate = ds;
        }
      }
    }

    // Compute totals across ALL deals (not just UNPAID/PARTIAL) per client,
    // so that prepayments on PAID deals offset gross debt — matching Excel logic.
    const allDealsWhere: Prisma.DealWhereInput = {
      ...dealScope,
      status: { notIn: ['CANCELED', 'REJECTED'] },
      isArchived: false,
    };
    if (managerId) (allDealsWhere as Record<string, unknown>).managerId = managerId;

    const allDealsAgg = await prisma.deal.groupBy({
      by: ['clientId'],
      where: allDealsWhere,
      _sum: { amount: true, paidAmount: true },
    });

    // Build a map of per-client ALL-deals net balance
    const allDealsBalanceMap = new Map<string, number>();
    for (const row of allDealsAgg) {
      const balance = Number(row._sum.amount ?? 0) - Number(row._sum.paidAmount ?? 0);
      allDealsBalanceMap.set(row.clientId, balance);
    }

    // Also find clients with prepayments (negative balance) who have NO UNPAID/PARTIAL deals,
    // so they wouldn't be in clientMap. We need to add them to the list.
    const prepaymentClientIds: string[] = [];
    for (const [clientId, balance] of allDealsBalanceMap) {
      if (balance < 0 && !clientMap.has(clientId)) {
        prepaymentClientIds.push(clientId);
      }
    }

    // Fetch client info for prepayment-only clients
    if (prepaymentClientIds.length > 0) {
      const prepClients = await prisma.client.findMany({
        where: { id: { in: prepaymentClientIds } },
        select: { id: true, companyName: true },
      });

      // Get last payment date for these clients
      for (const pc of prepClients) {
        const lastPayment = await prisma.payment.findFirst({
          where: { clientId: pc.id },
          orderBy: { paidAt: 'desc' },
          select: { paidAt: true },
        });

        // Get primary manager from their deals
        const managerAgg = await prisma.deal.groupBy({
          by: ['managerId'],
          where: { clientId: pc.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
          _count: true,
          orderBy: { _count: { managerId: 'desc' } },
          take: 1,
        });

        let manager: { id: string; fullName: string } | null = null;
        if (managerAgg.length > 0) {
          const mgr = await prisma.user.findUnique({
            where: { id: managerAgg[0].managerId },
            select: { id: true, fullName: true },
          });
          if (mgr) manager = mgr;
        }

        clientMap.set(pc.id, {
          clientId: pc.id,
          clientName: pc.companyName || '',
          totalDebt: 0,
          totalAmount: 0,
          totalPaid: 0,
          dealsCount: 0,
          lastPaymentDate: lastPayment?.paidAt?.toISOString() || null,
          managers: new Map(),
          newestDealDate: '',
          oldestUnpaidDueDate: null,
          hasPartial: false,
          hasPaid: true,
        });
      }
    }

    let clients = [...clientMap.values()].map((c) => {
      let primaryManager: { id: string; fullName: string } | null = null;
      let maxCount = 0;
      for (const [, mgr] of c.managers) {
        if (mgr.count > maxCount) { maxCount = mgr.count; primaryManager = { id: mgr.id, fullName: mgr.fullName }; }
      }

      // Use ALL-deals net balance instead of just UNPAID/PARTIAL sum,
      // so overpayments on PAID deals offset debt correctly.
      const allDealsBalance = allDealsBalanceMap.get(c.clientId);
      const effectiveDebt = allDealsBalance !== undefined ? allDealsBalance : c.totalDebt;

      return {
        clientId: c.clientId,
        clientName: c.clientName,
        totalDebt: effectiveDebt,
        totalAmount: c.totalAmount,
        totalPaid: c.totalPaid,
        dealsCount: c.dealsCount,
        lastPaymentDate: c.lastPaymentDate,
        manager: primaryManager,
        newestDealDate: c.newestDealDate,
        oldestUnpaidDueDate: c.oldestUnpaidDueDate,
        paymentStatus: (c.hasPartial || c.hasPaid ? 'PARTIAL' : 'UNPAID') as 'UNPAID' | 'PARTIAL',
      };
    });

    // Remove clients with zero debt (fully settled)
    clients = clients.filter((c) => c.totalDebt !== 0);

    if (minDebt) {
      clients = clients.filter((c) => c.totalDebt >= minDebt);
    }

    const totalDealsCount = clients.reduce((s, c) => s + c.dealsCount, 0);

    // Compute totals from live CRM data (per-client aggregation)
    let grossDebt = 0;
    let prepayments = 0;
    for (const c of clients) {
      if (c.totalDebt > 0) grossDebt += c.totalDebt;
      else prepayments += c.totalDebt;
    }
    const netDebt = grossDebt + prepayments;

    res.json({
      clients,
      totals: {
        clientCount: clients.length,
        dealsCount: totalDealsCount,
        grossDebt,
        prepayments,
        totalDebt: netDebt,
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

    // Also compute ALL-deals net balance so overpayments on PAID deals are reflected
    const allDealsForClient = await prisma.deal.findMany({
      where: {
        clientId,
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
      },
      select: { amount: true, paidAmount: true },
    });
    const allDealsNetBalance = allDealsForClient.reduce(
      (sum, d) => sum + (Number(d.amount) - Number(d.paidAmount)), 0,
    );

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
      totalDebt: allDealsNetBalance,
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
