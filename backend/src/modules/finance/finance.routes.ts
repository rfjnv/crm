import { Router, Request, Response } from 'express';
import { Role, Prisma, PaymentMethod, PaymentStatus as PrismaPaymentStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope, type AuthUser } from '../../lib/scope';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';

function paymentStatusFromAmounts(dealAmount: number, paid: number): PrismaPaymentStatus {
  if (paid <= 0) return 'UNPAID';
  if (paid >= dealAmount) return 'PAID';
  return 'PARTIAL';
}

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
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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
        clientIsSvip: !!p.client?.isSvip,
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
      status: 'CLOSED',
      isArchived: false,
    };
    if (managerId) where.managerId = managerId;

    const deals = await prisma.deal.findMany({
      where,
      include: {
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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
      isSvip: boolean;
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
      if (debt <= 0) continue;

      if (!clientMap.has(cid)) {
        clientMap.set(cid, {
          clientId: cid,
          clientName: deal.client?.companyName || '',
          isSvip: !!deal.client?.isSvip,
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
      if (deal.client?.isSvip) entry.isSvip = true;
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
        status: 'CLOSED',
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
        select: { id: true, companyName: true, isSvip: true, creditStatus: true },
      });

      for (const pc of prepClients) {
        const lastPayment = await prisma.payment.findFirst({
          where: { clientId: pc.id },
          orderBy: { paidAt: 'desc' },
          select: { paidAt: true },
        });

        const managerAgg = await prisma.deal.groupBy({
          by: ['managerId'],
          where: { clientId: pc.id, isArchived: false, status: 'CLOSED' },
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
          isSvip: !!pc.isSvip,
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
        isSvip: c.isSvip,
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

    const netDebt = totalDebtOwed; // The user requested explicitly that the total debt exactly equal the sum of positive debtors' debts

    res.json({
      clients,
      totals: {
        clientCount: clients.length,
        dealsCount: totalDealsCount,
        totalDebtGiven: totalDebtOwed,      // Общий долг (сумма всех плюсов)
        totalDebtOwed: netDebt,             // Чистый долг (плюсы минус минусы)
        prepayments,                        // Передоплаты
      },
    });
  }),
);

// ──── ACTIVE (NON-CLOSED) DEALS — суммы по сделкам в работе ────
router.get(
  '/active-deals',
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };
    const dealScope = ownerScope(user);
    const managerId = req.query.managerId as string | undefined;

    const where: Prisma.DealWhereInput = {
      ...dealScope,
      status: { notIn: ['CLOSED', 'CANCELED', 'REJECTED'] },
      isArchived: false,
    };
    if (managerId) where.managerId = managerId;

    const rows = await prisma.deal.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        amount: true,
        paidAmount: true,
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const deals = rows.map((d) => {
      const amount = Number(d.amount);
      const paidAmount = Number(d.paidAmount);
      return {
        dealId: d.id,
        title: d.title,
        status: d.status,
        clientId: d.client.id,
        clientName: d.client.companyName,
        clientIsSvip: !!d.client.isSvip,
        amount,
        paidAmount,
        remaining: amount - paidAmount,
        manager: d.manager ? { id: d.manager.id, fullName: d.manager.fullName } : null,
      };
    });

    const totals = deals.reduce(
      (acc, d) => {
        acc.totalAmount += d.amount;
        acc.totalPaid += d.paidAmount;
        acc.totalRemaining += d.remaining;
        return acc;
      },
      { totalAmount: 0, totalPaid: 0, totalRemaining: 0 },
    );

    res.json({ deals, totals, count: deals.length });
  }),
);

// ──── ACTIVE DEAL PAYMENT CONTEXT (касса / «Активные») ────
router.get(
  '/deals/:dealId/payment-context',
  asyncHandler(async (req: Request, res: Response) => {
    const dealId = req.params.dealId as string;
    const user: AuthUser = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };
    const dealScope = ownerScope(user);

    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...dealScope, isArchived: false },
      include: { client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } } },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена');

    const siblings = await prisma.deal.findMany({
      where: {
        clientId: deal.clientId,
        id: { not: dealId },
        ...dealScope,
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
      },
      select: { amount: true, paidAmount: true },
    });

    const creditFromOtherDeals = siblings.reduce(
      (s, d) => s + Math.max(0, Number(d.paidAmount) - Number(d.amount)),
      0,
    );

    const amount = Number(deal.amount);
    const paidAmount = Number(deal.paidAmount);
    const remaining = amount - paidAmount;
    const overpaymentOnThisDeal = Math.max(0, paidAmount - amount);

    res.json({
      deal: {
        dealId: deal.id,
        title: deal.title,
        status: deal.status,
        clientId: deal.clientId,
        clientName: deal.client.companyName,
        clientIsSvip: !!deal.client.isSvip,
        amount,
        paidAmount,
        remaining,
        overpaymentOnThisDeal,
      },
      creditFromOtherDeals,
    });
  }),
);

/** Зачёт переплаты с других сделок клиента (в пределах ownerScope) на выбранную сделку */
router.post(
  '/deals/:dealId/apply-client-credit',
  asyncHandler(async (req: Request, res: Response) => {
    const dealId = req.params.dealId as string;
    const user: AuthUser = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
    };
    const dealScope = ownerScope(user);

    const rawAmount = req.body?.amount;
    const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(400, 'Укажите положительную сумму');
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
    let paidAt = new Date();
    if (req.body?.paidAt) {
      paidAt = new Date(req.body.paidAt as string);
      if (Number.isNaN(paidAt.getTime())) throw new AppError(400, 'Некорректная дата оплаты');
    }
    if (paidAt > new Date()) throw new AppError(400, 'Дата оплаты не может быть в будущем');

    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.deal.findFirst({
        where: { id: dealId, ...dealScope, isArchived: false },
      });
      if (!target) throw new AppError(404, 'Сделка не найдена');
      if (target.status === 'CANCELED' || target.status === 'REJECTED') {
        throw new AppError(400, 'Нельзя зачесть переплату на отменённую сделку');
      }

      const siblings = await tx.deal.findMany({
        where: {
          clientId: target.clientId,
          id: { not: dealId },
          ...dealScope,
          isArchived: false,
          status: { notIn: ['CANCELED', 'REJECTED'] },
        },
        select: {
          id: true,
          title: true,
          amount: true,
          paidAmount: true,
          version: true,
        },
      });

      const pool = siblings.reduce(
        (s, d) => s + Math.max(0, Number(d.paidAmount) - Number(d.amount)),
        0,
      );
      const applyTotal = Math.min(amount, pool);
      if (applyTotal <= 0) {
        throw new AppError(400, 'Нет доступной переплаты на других сделках клиента (в вашей зоне видимости)');
      }

      const sourcesSorted = siblings
        .map((d) => ({
          ...d,
          surplus: Math.max(0, Number(d.paidAmount) - Number(d.amount)),
        }))
        .filter((d) => d.surplus > 0)
        .sort((a, b) => b.surplus - a.surplus);

      let left = applyTotal;
      for (const src of sourcesSorted) {
        if (left <= 0) break;
        const take = Math.min(src.surplus, left);
        const newPaid = Number(src.paidAmount) - take;
        const amt = Number(src.amount);
        const ps = paymentStatusFromAmounts(amt, newPaid);

        const upd = await tx.deal.updateMany({
          where: { id: src.id, version: src.version },
          data: {
            paidAmount: newPaid,
            paymentStatus: ps,
            version: { increment: 1 },
          },
        });
        if (upd.count === 0) {
          throw new AppError(409, 'Сделка-источник была изменена. Обновите страницу и повторите.');
        }
        left -= take;
      }

      if (left > 0.01) {
        throw new AppError(500, 'Не удалось завершить зачёт переплаты');
      }

      const tgtAmt = Number(target.amount);
      const newTgtPaid = Number(target.paidAmount) + applyTotal;
      const tgtPs = paymentStatusFromAmounts(tgtAmt, newTgtPaid);

      const tgtUpd = await tx.deal.updateMany({
        where: { id: target.id, version: target.version },
        data: {
          paidAmount: newTgtPaid,
          paymentStatus: tgtPs,
          version: { increment: 1 },
        },
      });
      if (tgtUpd.count === 0) {
        throw new AppError(409, 'Сделка была изменена. Обновите страницу и повторите.');
      }

      const created = await tx.payment.create({
        data: {
          dealId: target.id,
          clientId: target.clientId,
          amount: applyTotal,
          paidAt,
          method: 'TRANSFER',
          note: note || 'Зачёт переплаты с других сделок клиента',
          createdBy: user.userId,
        },
        include: {
          creator: { select: { id: true, fullName: true } },
        },
      });

      return { created, applyTotal, newTargetPaid: newTgtPaid };
    });

    await auditLog({
      userId: user.userId,
      action: 'PAYMENT_CREATE',
      entityType: 'deal',
      entityId: dealId,
      after: {
        paymentId: result.created.id,
        kind: 'CLIENT_CREDIT_APPLY',
        amount: result.applyTotal,
        newPaidAmount: result.newTargetPaid,
      },
    });

    res.status(201).json(result.created);
  }),
);

// ──── CLIENT DEBT DETAIL ────
router.get(
  '/debts/client/:clientId',
  asyncHandler(async (req: Request, res: Response) => {
    const clientId = req.params.clientId as string;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, companyName: true, contactName: true, phone: true, isSvip: true, creditStatus: true },
    });
    if (!client) throw new AppError(404, 'Клиент не найден');

    const deals = await prisma.deal.findMany({
      where: {
        clientId,
        status: 'CLOSED',
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

router.get(
  '/company-balance',
  authorize('WAREHOUSE_MANAGER', 'ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'),
  asyncHandler(async (req: Request, res: Response) => {
    const period = (req.query.period as string) || 'month';
    const method = req.query.method as string | undefined;
    const managerId = req.query.managerId as string | undefined;

    const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } });
    if (!settings?.balanceStartDate) {
      res.json({
        setupRequired: true,
        startDate: null,
        initialBalance: Number(settings?.initialBalance || 0),
      });
      return;
    }

    const startDate = new Date(settings.balanceStartDate);
    const now = new Date();
    const rangeStart = (() => {
      const d = new Date(now);
      if (period === 'day') d.setDate(d.getDate() - 1);
      else if (period === 'week') d.setDate(d.getDate() - 7);
      else if (period === 'year') d.setFullYear(d.getFullYear() - 1);
      else d.setMonth(d.getMonth() - 1);
      return d < startDate ? startDate : d;
    })();

    const paymentWhere: Prisma.PaymentWhereInput = {
      paidAt: { gte: startDate, lte: now },
      ...(method ? { method } : {}),
      ...(managerId ? { deal: { managerId } } : {}),
    };
    const dealWhereFilter: Prisma.DealWhereInput = {
      isArchived: false,
      ...(method ? { paymentMethod: method as PaymentMethod } : {}),
      ...(managerId ? { managerId } : {}),
    };

    const paymentRangeWhere: Prisma.PaymentWhereInput = {
      paidAt: { gte: rangeStart, lte: now },
      ...(method ? { method } : {}),
      ...(managerId ? { deal: { managerId } } : {}),
    };

    const paymentBeforeRangeWhere: Prisma.PaymentWhereInput = {
      paidAt: { gte: startDate, lt: rangeStart },
      ...(method ? { method } : {}),
      ...(managerId ? { deal: { managerId } } : {}),
    };

    const expenseWhere: Prisma.ExpenseWhereInput = {
      status: 'APPROVED',
      date: { gte: startDate, lte: now },
    };
    const expenseRangeWhere: Prisma.ExpenseWhereInput = {
      status: 'APPROVED',
      date: { gte: rangeStart, lte: now },
    };
    const expenseBeforeRangeWhere: Prisma.ExpenseWhereInput = {
      status: 'APPROVED',
      date: { gte: startDate, lt: rangeStart },
    };

    const [
      incomingAllAgg,
      incomingBeforeRangeAgg,
      incomingRows,
      expenseAllAgg,
      expenseBeforeRangeAgg,
      expenseRows,
      expectedRows,
      debtRows,
    ] = await Promise.all([
      prisma.payment.aggregate({ where: paymentWhere, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: paymentBeforeRangeWhere, _sum: { amount: true } }),
      prisma.payment.findMany({
        where: paymentRangeWhere,
        select: { paidAt: true, amount: true },
        orderBy: { paidAt: 'asc' },
      }),
      prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: expenseBeforeRangeWhere, _sum: { amount: true } }),
      prisma.expense.findMany({
        where: expenseRangeWhere,
        select: { date: true, amount: true },
        orderBy: { date: 'asc' },
      }),
      prisma.deal.findMany({
        where: {
          ...dealWhereFilter,
          status: { notIn: ['CLOSED', 'CANCELED', 'REJECTED'] },
        },
        select: { amount: true, paidAmount: true },
      }),
      prisma.deal.findMany({
        where: {
          ...dealWhereFilter,
          status: 'CLOSED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        select: { amount: true, paidAmount: true },
      }),
    ]);

    const initialBalance = Number(settings.initialBalance || 0);
    const incomingAll = Number(incomingAllAgg._sum.amount || 0);
    const incomingBeforeRange = Number(incomingBeforeRangeAgg._sum.amount || 0);
    const expensesAll = Number(expenseAllAgg._sum.amount || 0);
    const expensesBeforeRange = Number(expenseBeforeRangeAgg._sum.amount || 0);
    const realBalance = initialBalance + incomingAll - expensesAll;

    const expectedAmount = expectedRows.reduce(
      (sum, d) => sum + Math.max(0, Number(d.amount) - Number(d.paidAmount)),
      0,
    );
    const debtAmount = debtRows.reduce(
      (sum, d) => sum + Math.max(0, Number(d.amount) - Number(d.paidAmount)),
      0,
    );

    const incomingByDay = new Map<string, number>();
    for (const p of incomingRows) {
      const day = p.paidAt.toISOString().slice(0, 10);
      incomingByDay.set(day, (incomingByDay.get(day) || 0) + Number(p.amount));
    }

    const outgoingByDay = new Map<string, number>();
    for (const e of expenseRows) {
      const day = e.date.toISOString().slice(0, 10);
      outgoingByDay.set(day, (outgoingByDay.get(day) || 0) + Number(e.amount));
    }

    const days: string[] = [];
    for (let d = new Date(rangeStart); d <= now; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d).toISOString().slice(0, 10));
    }

    let runningBalance = initialBalance + incomingBeforeRange - expensesBeforeRange;
    const balanceLine = days.map((day) => {
      const incoming = incomingByDay.get(day) || 0;
      const outgoing = outgoingByDay.get(day) || 0;
      runningBalance += incoming - outgoing;
      return { day, balance: Math.round(runningBalance * 100) / 100 };
    });

    const cashFlow = days.map((day) => ({
      day,
      incoming: Math.round((incomingByDay.get(day) || 0) * 100) / 100,
      outgoing: Math.round((outgoingByDay.get(day) || 0) * 100) / 100,
    }));

    const paymentsPerDay = days.map((day) => ({
      day,
      total: Math.round((incomingByDay.get(day) || 0) * 100) / 100,
    }));

    res.json({
      setupRequired: false,
      updatedAt: new Date().toISOString(),
      filters: { period, method: method || null, managerId: managerId || null },
      startDate: settings.balanceStartDate.toISOString(),
      initialBalance,
      kpi: {
        balance: Math.round(realBalance * 100) / 100,
        cash: Math.round(realBalance * 100) / 100,
        bank: 0,
      },
      breakdown: {
        real: Math.round(realBalance * 100) / 100,
        expected: Math.round(expectedAmount * 100) / 100,
        debts: Math.round(debtAmount * 100) / 100,
      },
      charts: {
        balanceLine,
        cashFlow,
        paymentsPerDay,
      },
    });
  }),
);

export { router as financeRoutes };
