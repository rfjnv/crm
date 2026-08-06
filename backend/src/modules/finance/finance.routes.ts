import { Router, Request, Response } from 'express';
import { Role, Prisma, PaymentMethod, PaymentStatus as PrismaPaymentStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope, assertCompanyScoped, type AuthUser } from '../../lib/scope';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { buildClientCreditNote, cashOnlyFilter, isNonCashKind } from '../../lib/payment-kind';
import { tashkentDayKey, tashkentStartOfToday } from '../../lib/tz';
import { buildSearchVariants } from '../../lib/translit';

function paymentStatusFromAmounts(dealAmount: number, paid: number): PrismaPaymentStatus {
  if (paid <= 0) return 'UNPAID';
  if (paid >= dealAmount) return 'PAID';
  return 'PARTIAL';
}

const router = Router();

router.use(authenticate);

/**
 * Роли, допущенные к финансовым реестрам (касса, долги, активные сделки).
 * До этого у `/debts` и `/active-deals` не было проверки вовсе, а `ownerScope`
 * считает полноправными в том числе DRIVER, LOADER, HR и WAREHOUSE — то есть весь
 * долговой реестр компании был доступен водителям и грузчикам.
 */
const FINANCE_ROLES = ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN', 'WAREHOUSE_MANAGER', 'OPERATOR'] as const;

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
    // Кто принял деньги — для кассы это более важный разрез, чем менеджер сделки.
    const receivedById = req.query.receivedById as string | undefined;

    const getTashkentDayKey = tashkentDayKey;
    const startOfDay = tashkentStartOfToday();
    let fromDate: Date;
    let toDate: Date | undefined;

    // Произвольный диапазон — без него нельзя закрыть месяц или свести любой период,
    // не совпадающий с четырьмя предустановками.
    const rawFrom = req.query.from as string | undefined;
    const rawTo = req.query.to as string | undefined;

    if (period === 'custom' && rawFrom) {
      const parsedFrom = new Date(rawFrom);
      if (Number.isNaN(parsedFrom.getTime())) throw new AppError(400, 'Некорректная дата начала периода');
      fromDate = parsedFrom;
      if (rawTo) {
        const parsedTo = new Date(rawTo);
        if (Number.isNaN(parsedTo.getTime())) throw new AppError(400, 'Некорректная дата конца периода');
        if (parsedTo < parsedFrom) throw new AppError(400, 'Конец периода раньше начала');
        toDate = parsedTo;
      }
    } else if (period === 'yesterday') {
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

    const reqUser = req.user!;
    const companyId = (reqUser.role !== 'SUPER_ADMIN' && reqUser.companyId) ? reqUser.companyId : undefined;

    // Build where clause for payments
    const where: Prisma.PaymentWhereInput = {
      paidAt: {
        gte: fromDate,
        ...(toDate ? { lt: toDate } : {}),
      },
      ...(companyId ? { client: { companyId } } : {}),
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
    if (receivedById) {
      // Старые записи не имеют receivedById — для них принявшим считается автор.
      where.OR = [{ receivedById }, { receivedById: null, createdBy: receivedById }];
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

    // Денежные итоги считаются ТОЛЬКО по поступлениям. Зачёт переплаты и прочие
    // служебные проводки остаются в списке (кассиру важно их видеть), но в суммы
    // не входят — иначе одни и те же деньги считаются дважды.
    const cashPayments = filteredPayments.filter((p) => !isNonCashKind(p.kind));
    const nonCashAmount = filteredPayments
      .filter((p) => isNonCashKind(p.kind))
      .reduce((s, p) => s + Number(p.amount), 0);

    const totalAmount = cashPayments.reduce((s, p) => s + Number(p.amount), 0);

    // Breakdown by method
    const byMethod: Record<string, number> = {};
    for (const p of cashPayments) {
      const key = p.method || 'Не указан';
      byMethod[key] = (byMethod[key] || 0) + Number(p.amount);
    }

    // «Итого за сегодня» не зависит от выбранного периода и фильтров — иначе при
    // периоде «Вчера» карточка всегда показывала 0, а при фильтре по клиенту —
    // сегодняшний приход одного клиента под заголовком «за сегодня».
    const todayAgg = await prisma.payment.aggregate({
      where: {
        paidAt: { gte: startOfDay },
        ...(companyId ? { client: { companyId } } : {}),
        ...cashOnlyFilter,
      },
      _sum: { amount: true },
    });
    const todayTotal = Number(todayAgg._sum.amount || 0);

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
        receivedBy: p.receivedBy?.fullName || p.creator?.fullName,
        manager: p.deal?.manager?.fullName,
        dealPaymentStatus: p.deal?.paymentStatus,
        entryType: p.entryType,
        kind: p.kind,
      })),
      totals: {
        totalAmount,
        todayTotal,
        // Считаем только денежные проводки — служебные видны в списке, но не в итогах.
        count: cashPayments.length,
        nonCashAmount,
        nonCashCount: filteredPayments.length - cashPayments.length,
      },
      byMethod: Object.entries(byMethod).map(([m, total]) => ({ method: m, total })),
      period,
      fromDate: fromDate.toISOString(),
    });
  }),
);

// ──── DEBTS ────
router.get(
  '/debts',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
    };
    assertCompanyScoped(user);
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

    // Calculate debt and prepayment as SEPARATE pools across ALL deals for each
    // client — they are never netted against each other. Isolated payments are
    // marked as 'PAID' and would otherwise be ignored by the main query.
    const allDeals = await prisma.deal.findMany({
      where: {
        ...dealScope,
        status: 'CLOSED',
        isArchived: false,
        ...(managerId ? { managerId } : {}),
      },
      select: { clientId: true, amount: true, paidAmount: true },
    });

    const balanceMap = new Map<string, { debt: number; prepayment: number }>();
    for (const d of allDeals) {
      const balance = Number(d.amount) - Number(d.paidAmount);
      if (balance === 0) continue;
      const entry = balanceMap.get(d.clientId) ?? { debt: 0, prepayment: 0 };
      if (balance > 0) entry.debt += balance;
      else entry.prepayment += -balance;
      balanceMap.set(d.clientId, entry);
    }

    // Identify clients that have a non-zero balance (e.g., prepayments)
    // but were not fetched by the main query because they lack UNPAID/PARTIAL deals.
    const missingClientIds: string[] = [];
    for (const [clientId, balance] of balanceMap.entries()) {
      if ((balance.debt > 0 || balance.prepayment > 0) && !clientMap.has(clientId)) {
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

      // Use the ALL-DEALS pools: debt stays pure, prepayment is reported separately
      const pools = balanceMap.get(c.clientId) ?? { debt: c.totalDebt, prepayment: 0 };

      return {
        clientId: c.clientId,
        clientName: c.clientName,
        isSvip: c.isSvip,
        totalDebt: pools.debt,
        prepayment: pools.prepayment,
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

    // Remove clients with neither debt nor prepayment (fully settled)
    clients = clients.filter((c) => c.totalDebt !== 0 || c.prepayment !== 0);

    if (minDebt) {
      clients = clients.filter((c) => c.totalDebt >= minDebt);
    }

    const totalDealsCount = clients.reduce((s, c) => s + c.dealsCount, 0);

    // Debt and prepayments are two independent pools — never netted
    const totalDebt = clients.reduce((s, c) => s + c.totalDebt, 0);
    const prepayments = clients.reduce((s, c) => s + c.prepayment, 0);

    res.json({
      clients,
      totals: {
        clientCount: clients.length,
        dealsCount: totalDealsCount,
        totalDebtGiven: totalDebt,          // Общий долг (только долг, без вычета переплат)
        totalDebtOwed: totalDebt,           // То же значение — переплаты не вычитаются
        prepayments,                        // Передоплаты (отдельно)
      },
    });
  }),
);

// ──── ACTIVE (NON-CLOSED) DEALS — суммы по сделкам в работе ────
router.get(
  '/active-deals',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const user = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
    };
    assertCompanyScoped(user);
    const dealScope = ownerScope(user);
    const managerId = req.query.managerId as string | undefined;
    // Сделка, закрытая сегодня, мгновенно уходила из «Активных» в «Долги» — и чтобы
    // принять по ней деньги, кассиру приходилось искать клиента среди всех должников.
    // Теперь такие сделки остаются здесь до конца дня.
    const startOfToday = tashkentStartOfToday();

    const where: Prisma.DealWhereInput = {
      ...dealScope,
      isArchived: false,
      OR: [
        { status: { notIn: ['CLOSED', 'CANCELED', 'REJECTED'] } },
        { status: 'CLOSED', closedAt: { gte: startOfToday } },
      ],
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
        isReceiptPunched: true,
        closedAt: true,
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
        isReceiptPunched: d.isReceiptPunched,
        closedToday: d.status === 'CLOSED',
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

    res.json({
      deals,
      totals,
      count: deals.length,
      closedTodayCount: deals.filter((d) => d.closedToday).length,
    });
  }),
);

// ──── ПОИСК СДЕЛКИ ДЛЯ ПРИЁМА ОПЛАТЫ ────
/**
 * Единая точка входа кассира: «пришёл человек с деньгами».
 *
 * Раньше приём оплаты был привязан к состоянию сделки — активные лежали в одной
 * вкладке, закрытые долги в другой, агрегированные по клиенту и без поиска по сделке.
 * Здесь ищем по названию сделки, клиенту и номеру договора сразу, независимо от статуса.
 */
router.get(
  '/payable-deals',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const user: AuthUser = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
    };
    assertCompanyScoped(user);
    const dealScope = ownerScope(user);

    const q = ((req.query.q as string) || '').trim();
    if (q.length < 2) {
      res.json({ deals: [], query: q });
      return;
    }

    const variants = buildSearchVariants(q);
    const textMatch: Prisma.DealWhereInput[] = variants.flatMap((v) => [
      { title: { contains: v, mode: 'insensitive' as const } },
      { client: { companyName: { contains: v, mode: 'insensitive' as const } } },
      { client: { contactName: { contains: v, mode: 'insensitive' as const } } },
      { contract: { contractNumber: { contains: v, mode: 'insensitive' as const } } },
    ]);

    const rows = await prisma.deal.findMany({
      where: {
        ...dealScope,
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
        OR: textMatch,
      },
      select: {
        id: true,
        title: true,
        status: true,
        amount: true,
        paidAmount: true,
        closedAt: true,
        createdAt: true,
        client: { select: { id: true, companyName: true, isSvip: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { contractNumber: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 40,
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
        contractNumber: d.contract?.contractNumber ?? null,
        amount,
        paidAmount,
        remaining: amount - paidAmount,
        manager: d.manager ? { id: d.manager.id, fullName: d.manager.fullName } : null,
        createdAt: d.createdAt,
      };
    });

    // Сначала те, по которым реально есть что принять.
    deals.sort((a, b) => {
      if ((b.remaining > 0 ? 1 : 0) !== (a.remaining > 0 ? 1 : 0)) {
        return (b.remaining > 0 ? 1 : 0) - (a.remaining > 0 ? 1 : 0);
      }
      return b.remaining - a.remaining;
    });

    res.json({ deals, query: q });
  }),
);

// ──── ACTIVE DEAL PAYMENT CONTEXT (касса / «Активные») ────
router.get(
  '/deals/:dealId/payment-context',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const dealId = req.params.dealId as string;
    const user: AuthUser = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
    };
    assertCompanyScoped(user);
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
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const dealId = req.params.dealId as string;
    const user: AuthUser = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
    };
    assertCompanyScoped(user);
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

      const usedSources: { id: string; title: string | null; amount: number }[] = [];
      let left = applyTotal;
      for (const src of sourcesSorted) {
        if (left <= 0) break;
        const take = Math.min(src.surplus, left);
        usedSources.push({ id: src.id, title: src.title, amount: take });
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
          // Денег в кассу не поступает — это перенос уже полученной оплаты между
          // сделками клиента. Тип исключает проводку из кассовых и балансовых итогов.
          kind: 'CREDIT_TRANSFER',
          note: buildClientCreditNote(usedSources, note),
          createdBy: user.userId,
        },
        include: {
          creator: { select: { id: true, fullName: true } },
        },
      });

      return {
        created,
        applyTotal,
        newTargetPaid: newTgtPaid,
        requestedAmount: amount,
        usedSources,
      };
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
        requestedAmount: result.requestedAmount,
        newPaidAmount: result.newTargetPaid,
        // Без перечня источников зачёт нельзя ни отменить, ни разобрать постфактум.
        sources: result.usedSources,
      },
    });

    res.status(201).json({
      ...result.created,
      // Пул мог быть меньше запрошенного — фронт обязан показать, сколько зачлось на самом деле.
      appliedAmount: result.applyTotal,
      requestedAmount: result.requestedAmount,
      partiallyApplied: result.applyTotal + 0.01 < result.requestedAmount,
      sources: result.usedSources,
    });
  }),
);

// ──── CLIENT DEBT DETAIL ────
router.get(
  '/debts/client/:clientId',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const clientId = req.params.clientId as string;
    const user: AuthUser = {
      userId: req.user!.userId,
      role: req.user!.role as Role,
      permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
    };
    assertCompanyScoped(user);
    const dealScope = ownerScope(user);

    // Клиент ищется в пределах компании пользователя: иначе по чужому clientId
    // отдавались сделки и платежи любой организации в базе.
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        ...(user.role !== 'SUPER_ADMIN' && user.companyId ? { companyId: user.companyId } : {}),
      },
      select: { id: true, companyName: true, contactName: true, phone: true, isSvip: true, creditStatus: true },
    });
    if (!client) throw new AppError(404, 'Клиент не найден');

    const deals = await prisma.deal.findMany({
      where: {
        clientId,
        ...dealScope,
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
      where: { clientId, deal: dealScope },
      include: {
        deal: { select: { id: true, title: true } },
        creator: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 50,
    });

    const totalDebt = deals.reduce((sum, d) => sum + (Number(d.amount) - Number(d.paidAmount)), 0);

    // Also compute ALL-deals balances so overpayments on PAID deals are reflected.
    // Debt and prepayment are kept as separate pools — never netted against each other.
    const allDealsForClient = await prisma.deal.findMany({
      where: {
        clientId,
        ...dealScope,
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
      },
      select: { amount: true, paidAmount: true },
    });
    let allDealsDebt = 0;
    let allDealsPrepayment = 0;
    for (const d of allDealsForClient) {
      const balance = Number(d.amount) - Number(d.paidAmount);
      if (balance > 0) allDealsDebt += balance;
      else if (balance < 0) allDealsPrepayment += -balance;
    }

    // Метрики платёжной дисциплины отсюда убраны: они считались запросом на каждую
    // закрытую сделку клиента (N+1) и не отображались ни в одном интерфейсе.
    // Если понадобятся — считать одним groupBy, а не циклом.
    res.json({
      client,
      deals,
      payments,
      totalDebt: allDealsDebt,
      prepayment: allDealsPrepayment,
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

    // Реальный остаток кассы складывается только из поступлений денег. Служебные
    // проводки (зачёт переплаты) деньгами не являются и раньше завышали и баланс,
    // и KPI «банк», потому что зачёт записывался методом TRANSFER.
    const paymentWhere: Prisma.PaymentWhereInput = {
      paidAt: { gte: startDate, lte: now },
      ...cashOnlyFilter,
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
      ...cashOnlyFilter,
      ...(method ? { method } : {}),
      ...(managerId ? { deal: { managerId } } : {}),
    };

    const paymentBeforeRangeWhere: Prisma.PaymentWhereInput = {
      paidAt: { gte: startDate, lt: rangeStart },
      ...cashOnlyFilter,
      ...(method ? { method } : {}),
      ...(managerId ? { deal: { managerId } } : {}),
    };

    const expenseWhere: Prisma.ExpenseWhereInput = {
      status: 'APPROVED',
      date: { gte: startDate, lte: now },
      ...(method ? { method } : {}),
    };
    const expenseRangeWhere: Prisma.ExpenseWhereInput = {
      status: 'APPROVED',
      date: { gte: rangeStart, lte: now },
      ...(method ? { method } : {}),
    };
    const expenseBeforeRangeWhere: Prisma.ExpenseWhereInput = {
      status: 'APPROVED',
      date: { gte: startDate, lt: rangeStart },
      ...(method ? { method } : {}),
    };

    const [
      incomingAllAgg,
      incomingBeforeRangeAgg,
      incomingRows,
      incomingByMethodAgg,
      incomingRangeByMethodAgg,
      recentIncoming,
      expenseAllAgg,
      expenseBeforeRangeAgg,
      expenseRows,
      expenseByMethodAgg,
      expenseRangeByMethodAgg,
      expectedRows,
      debtRows,
    ] = await Promise.all([
      prisma.payment.aggregate({ where: paymentWhere, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: paymentBeforeRangeWhere, _sum: { amount: true } }),
      prisma.payment.findMany({
        where: paymentRangeWhere,
        select: { paidAt: true, amount: true, method: true },
        orderBy: { paidAt: 'asc' },
      }),
      prisma.payment.groupBy({
        by: ['method'],
        where: paymentWhere,
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ['method'],
        where: paymentRangeWhere,
        _sum: { amount: true },
      }),
      prisma.payment.findMany({
        where: paymentRangeWhere,
        orderBy: { paidAt: 'desc' },
        take: 50,
        select: {
          id: true,
          paidAt: true,
          amount: true,
          method: true,
          note: true,
          deal: { select: { id: true, title: true, isReceiptPunched: true } },
          client: { select: { id: true, companyName: true } },
          creator: { select: { id: true, fullName: true } },
          receivedBy: { select: { id: true, fullName: true } },
        },
      }),
      prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: expenseBeforeRangeWhere, _sum: { amount: true } }),
      prisma.expense.findMany({
        where: expenseRangeWhere,
        select: { date: true, amount: true, method: true },
        orderBy: { date: 'asc' },
      }),
      prisma.expense.groupBy({
        by: ['method'],
        where: expenseWhere,
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ['method'],
        where: expenseRangeWhere,
        _sum: { amount: true },
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

    // Дни считаются по Ташкенту — так же, как в «Кассе». Раньше здесь был UTC,
    // и вечерние платежи попадали в разные сутки в двух отчётах.
    const incomingByDay = new Map<string, number>();
    const incomingByDayMethodMap = new Map<string, Map<string, number>>();
    for (const p of incomingRows) {
      const day = tashkentDayKey(p.paidAt);
      const amt = Number(p.amount);
      incomingByDay.set(day, (incomingByDay.get(day) || 0) + amt);
      const key = p.method || 'UNKNOWN';
      if (!incomingByDayMethodMap.has(day)) incomingByDayMethodMap.set(day, new Map());
      const dayMap = incomingByDayMethodMap.get(day)!;
      dayMap.set(key, (dayMap.get(key) || 0) + amt);
    }

    const outgoingByDay = new Map<string, number>();
    const outgoingByDayMethodMap = new Map<string, Map<string, number>>();
    for (const e of expenseRows) {
      const day = tashkentDayKey(e.date);
      const amt = Number(e.amount);
      outgoingByDay.set(day, (outgoingByDay.get(day) || 0) + amt);
      const key = e.method || 'UNKNOWN';
      if (!outgoingByDayMethodMap.has(day)) outgoingByDayMethodMap.set(day, new Map());
      const dayMap = outgoingByDayMethodMap.get(day)!;
      dayMap.set(key, (dayMap.get(key) || 0) + amt);
    }

    const days: string[] = [];
    for (let d = new Date(rangeStart); d <= now; d.setDate(d.getDate() + 1)) {
      days.push(tashkentDayKey(new Date(d)));
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

    const incomeVsExpense = days.map((day) => {
      const inc = Math.round((incomingByDay.get(day) || 0) * 100) / 100;
      const out = Math.round((outgoingByDay.get(day) || 0) * 100) / 100;
      return {
        day,
        incoming: inc,
        outgoing: out,
        net: Math.round((inc - out) * 100) / 100,
      };
    });

    const ALL_METHODS = ['CASH', 'TRANSFER', 'PAYME', 'QR', 'CLICK', 'TERMINAL', 'INSTALLMENT', 'UNKNOWN'] as const;

    const incomingByDayMethod: { day: string; method: string; amount: number }[] = [];
    const expenseByDayMethod: { day: string; method: string; amount: number }[] = [];
    for (const day of days) {
      const incDay = incomingByDayMethodMap.get(day);
      const outDay = outgoingByDayMethodMap.get(day);
      for (const m of ALL_METHODS) {
        const inc = incDay?.get(m) || 0;
        const out = outDay?.get(m) || 0;
        if (inc > 0) incomingByDayMethod.push({ day, method: m, amount: Math.round(inc * 100) / 100 });
        if (out > 0) expenseByDayMethod.push({ day, method: m, amount: Math.round(out * 100) / 100 });
      }
    }

    const byMethod: Record<string, { incoming: number; outgoing: number; net: number; incomingInRange: number; outgoingInRange: number }> = {};
    for (const m of ALL_METHODS) byMethod[m] = { incoming: 0, outgoing: 0, net: 0, incomingInRange: 0, outgoingInRange: 0 };
    for (const row of incomingByMethodAgg) {
      const m = row.method || 'UNKNOWN';
      if (!byMethod[m]) byMethod[m] = { incoming: 0, outgoing: 0, net: 0, incomingInRange: 0, outgoingInRange: 0 };
      byMethod[m].incoming = Math.round(Number(row._sum.amount || 0) * 100) / 100;
    }
    for (const row of expenseByMethodAgg) {
      const m = row.method || 'UNKNOWN';
      if (!byMethod[m]) byMethod[m] = { incoming: 0, outgoing: 0, net: 0, incomingInRange: 0, outgoingInRange: 0 };
      byMethod[m].outgoing = Math.round(Number(row._sum.amount || 0) * 100) / 100;
    }
    for (const row of incomingRangeByMethodAgg) {
      const m = row.method || 'UNKNOWN';
      if (!byMethod[m]) byMethod[m] = { incoming: 0, outgoing: 0, net: 0, incomingInRange: 0, outgoingInRange: 0 };
      byMethod[m].incomingInRange = Math.round(Number(row._sum.amount || 0) * 100) / 100;
    }
    for (const row of expenseRangeByMethodAgg) {
      const m = row.method || 'UNKNOWN';
      if (!byMethod[m]) byMethod[m] = { incoming: 0, outgoing: 0, net: 0, incomingInRange: 0, outgoingInRange: 0 };
      byMethod[m].outgoingInRange = Math.round(Number(row._sum.amount || 0) * 100) / 100;
    }
    for (const m of Object.keys(byMethod)) {
      byMethod[m].net = Math.round((byMethod[m].incoming - byMethod[m].outgoing) * 100) / 100;
    }

    const incomingInRange = incomingRows.reduce((s, p) => s + Number(p.amount), 0);
    const outgoingInRange = expenseRows.reduce((s, e) => s + Number(e.amount), 0);

    res.json({
      setupRequired: false,
      updatedAt: new Date().toISOString(),
      filters: { period, method: method || null, managerId: managerId || null },
      startDate: settings.balanceStartDate.toISOString(),
      initialBalance,
      kpi: {
        balance: Math.round(realBalance * 100) / 100,
        cash: Math.round((byMethod.CASH?.net || 0) * 100) / 100,
        bank: Math.round(((byMethod.TRANSFER?.net || 0) + (byMethod.PAYME?.net || 0) + (byMethod.QR?.net || 0) + (byMethod.CLICK?.net || 0) + (byMethod.TERMINAL?.net || 0)) * 100) / 100,
        incomingAll: Math.round(incomingAll * 100) / 100,
        expensesAll: Math.round(expensesAll * 100) / 100,
        incomingInRange: Math.round(incomingInRange * 100) / 100,
        outgoingInRange: Math.round(outgoingInRange * 100) / 100,
        netInRange: Math.round((incomingInRange - outgoingInRange) * 100) / 100,
      },
      breakdown: {
        real: Math.round(realBalance * 100) / 100,
        expected: Math.round(expectedAmount * 100) / 100,
        debts: Math.round(debtAmount * 100) / 100,
      },
      byMethod,
      recentIncoming: recentIncoming.map((p) => ({
        id: p.id,
        paidAt: p.paidAt.toISOString(),
        amount: Math.round(Number(p.amount) * 100) / 100,
        method: p.method,
        note: p.note,
        deal: p.deal ? { id: p.deal.id, title: p.deal.title, isReceiptPunched: p.deal.isReceiptPunched } : null,
        client: p.client ? { id: p.client.id, name: p.client.companyName } : null,
        creator: p.creator ? { id: p.creator.id, fullName: p.creator.fullName } : null,
        receivedBy: p.receivedBy ? { id: p.receivedBy.id, fullName: p.receivedBy.fullName } : null,
      })),
      charts: {
        balanceLine,
        cashFlow,
        paymentsPerDay,
        incomeVsExpense,
        incomingByDayMethod,
        expenseByDayMethod,
      },
    });
  }),
);

export { router as financeRoutes };
