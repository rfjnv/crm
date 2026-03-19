import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope } from '../../lib/scope';
import { AppError } from '../../lib/errors';

const router = Router();

router.use(authenticate);

// ──── КАССА (Payments Report) ────
router.get(
  '/cashbox',
  authorize('WAREHOUSE_MANAGER', 'ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'),
  asyncHandler(async (req: Request, res: Response) => {
    const period = req.query.period as string || 'day';
    const managerId = req.query.managerId as string | undefined;
    const clientId = req.query.clientId as string | undefined;
    const method = req.query.method as string | undefined;
    const paymentStatus = req.query.paymentStatus as string | undefined;
    const entryType = req.query.entryType as string | undefined;

    const getTashkentDayKey = (date: Date) => {
      const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
      return new Date(date.getTime() + TASHKENT_OFFSET).toISOString().slice(0, 10);
    };

    // Calculate date range (Tashkent = UTC+5)
    const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
    const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
    const y = nowTashkent.getUTCFullYear();
    const m = nowTashkent.getUTCMonth();
    const d = nowTashkent.getUTCDate();
    const startOfDay = new Date(Date.UTC(y, m, d) - TASHKENT_OFFSET);
    let fromDate: Date;
    let toDate: Date | undefined;

    if (period === 'yesterday') {
      fromDate = new Date(startOfDay);
      fromDate.setDate(fromDate.getDate() - 1);
      toDate = new Date(startOfDay);
    } else if (period === 'week') {
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
      paidAt: {
        gte: fromDate,
        ...(toDate ? { lt: toDate } : {}),
      },
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
            createdAt: true,
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
    const typedPayments = payments.map((payment) => {
      const isDebtCollection = !!payment.deal?.createdAt
        && getTashkentDayKey(payment.paidAt) > getTashkentDayKey(payment.deal.createdAt);

      return {
        ...payment,
        entryType: isDebtCollection ? 'DEBT_COLLECTION' : 'SALE_PAYMENT',
      };
    });

    let filteredPayments = typedPayments;
    if (paymentStatus === 'PAID' || paymentStatus === 'PARTIAL') {
      filteredPayments = filteredPayments.filter((p) => p.deal?.paymentStatus === paymentStatus);
    }
    if (entryType === 'DEBT_COLLECTION' || entryType === 'SALE_PAYMENT') {
      filteredPayments = filteredPayments.filter((p) => p.entryType === entryType);
    }

    // Calculate totals
    const totalAmount = filteredPayments.reduce((s, p) => s + Number(p.amount), 0);

    // Breakdown by method
    const byMethod: Record<string, number> = {};
    for (const p of filteredPayments) {
      const key = p.method || 'Не указан';
      byMethod[key] = (byMethod[key] || 0) + Number(p.amount);
    }

    // Breakdown by day (Tashkent timezone)
    const byDay: Record<string, number> = {};
    for (const p of filteredPayments) {
      const tashkentDate = new Date(p.paidAt.getTime() + TASHKENT_OFFSET);
      const day = tashkentDate.toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + Number(p.amount);
    }

    // Daily total (today in Tashkent)
    const todayStr = nowTashkent.toISOString().slice(0, 10);
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
        entryType: p.entryType,
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

    // Calculate accurate net balance across ALL deals for each client, because
    // isolated payments are marked as 'PAID' and would be ignored by the main query.
    const allDealsGrouped = await prisma.deal.groupBy({
      by: ['clientId'],
      where: {
        ...dealScope,
        status: { notIn: ['CANCELED', 'REJECTED'] },
        isArchived: false,
        ...(managerId ? { managerId } : {}),
      },
      _sum: {
        amount: true,
        paidAmount: true,
      }
    });

    const trueDebtMap = new Map<string, number>();
    for (const row of allDealsGrouped) {
      const netDebt = Number(row._sum.amount ?? 0) - Number(row._sum.paidAmount ?? 0);
      trueDebtMap.set(row.clientId, netDebt);
    }

    // Identify clients that have a non-zero net balance (e.g., prepayments) 
    // but were not fetched by the main query because they lack UNPAID/PARTIAL deals.
    const missingClientIds: string[] = [];
    for (const [clientId, balance] of trueDebtMap.entries()) {
      if (balance !== 0 && !clientMap.has(clientId)) {
        missingClientIds.push(clientId);
      }
    }

    if (missingClientIds.length > 0) {
      const prepClients = await prisma.client.findMany({
        where: { id: { in: missingClientIds } },
        select: { id: true, companyName: true },
      });

      for (const pc of prepClients) {
        const lastPayment = await prisma.payment.findFirst({
          where: { clientId: pc.id },
          orderBy: { paidAt: 'desc' },
          select: { paidAt: true },
        });

        const managerAgg = await prisma.deal.groupBy({
          by: ['managerId'],
          where: { clientId: pc.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
          _count: true,
          orderBy: { _count: { managerId: 'desc' } },
          take: 1,
        });

        let mgrObj: { id: string; fullName: string; count: number } | null = null;
        if (managerAgg.length > 0) {
          const mgr = await prisma.user.findUnique({
            where: { id: managerAgg[0].managerId },
            select: { id: true, fullName: true },
          });
          if (mgr) mgrObj = { id: mgr.id, fullName: mgr.fullName, count: 1 };
        }

        const managers = new Map<string, { id: string; fullName: string; count: number }>();
        if (mgrObj) managers.set(mgrObj.id, mgrObj);

        clientMap.set(pc.id, {
          clientId: pc.id,
          clientName: pc.companyName || '',
          totalDebt: 0,
          totalAmount: 0,
          totalPaid: 0,
          dealsCount: 0, // we omit deal details since they only have PAID deals
          lastPaymentDate: lastPayment?.paidAt?.toISOString() || null,
          managers,
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

      // Use the true ALL-DEALS aggregated debt
      const effectiveDebt = trueDebtMap.get(c.clientId) ?? c.totalDebt;

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

    let totalDebtOwed = 0; // Pure positive debt pool
    let prepayments = 0;   // Pure negative debt pool

    for (const c of clients) {
      if (c.totalDebt > 0) totalDebtOwed += c.totalDebt;
      else if (c.totalDebt < 0) prepayments += Math.abs(c.totalDebt);
    }

    const totalDebtGiven = totalDebtOwed + prepayments;

    res.json({
      clients,
      totals: {
        clientCount: clients.length,
        dealsCount: totalDealsCount,
        totalDebtGiven,      // Общий долг (К+НК+ПК+Ф)
        totalDebtOwed,       // Чистый долг (К+НК+ПК+Ф+ПП)
        prepayments,         // Передоплаты
      },
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
