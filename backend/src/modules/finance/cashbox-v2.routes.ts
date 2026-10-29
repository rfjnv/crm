import { Router, Request, Response } from 'express';
import { Role, Prisma, PaymentStatus as PrismaPaymentStatus } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope, type AuthUser } from '../../lib/scope';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { hasRole } from '../../lib/roles';
import { buildClientCreditNote, cashOnlyFilter } from '../../lib/payment-kind';
import { tashkentStartOfToday } from '../../lib/tz';
import { storeFinanceTelegramLog } from '../telegram/telegram-deal-groups.service';
import { MAX_PAYMENT_AMOUNT } from '../deals/deals.dto';
import { resolveUsdPart, type UsdPart } from '../../lib/paymentUsd';

/**
 * «Касса 2.0» — приём денег за минимум шагов.
 *
 * Старая касса делила должников на «Активные» (по сделкам) и «Долги» (по клиентам,
 * только закрытые сделки), а принять деньги по клиенту можно было только сделку за
 * сделкой — каждый раз через две модалки. Здесь один список «к оплате» и проведение
 * одной суммы на несколько сделок клиента в одной транзакции.
 */

const FINANCE_ROLES = ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN', 'WAREHOUSE_MANAGER', 'OPERATOR'] as const;

/** Сделки, по которым ещё можно что-то принять. */
const OPEN_DEAL_WHERE: Prisma.DealWhereInput = {
  isArchived: false,
  status: { notIn: ['CANCELED', 'REJECTED'] },
  paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
};

/** Деньги — в тийинах, чтобы раскладка по сделкам не набирала ошибок округления. */
const toCents = (v: number | Prisma.Decimal) => Math.round(Number(v) * 100);
const fromCents = (c: number) => c / 100;

function paymentStatusFromAmounts(dealAmount: number, paid: number): PrismaPaymentStatus {
  if (paid <= 0) return 'UNPAID';
  if (paid >= dealAmount) return 'PAID';
  return 'PARTIAL';
}

function authUser(req: Request): AuthUser {
  return {
    userId: req.user!.userId,
    role: req.user!.role as Role,
    permissions: req.user!.permissions || [],
  };
}

const router = Router();
router.use(authenticate);

// ──── СПИСОК «К ОПЛАТЕ» ────
router.get(
  '/to-pay',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const user = authUser(req);
    const managerId = req.query.managerId as string | undefined;

    const rows = await prisma.deal.findMany({
      where: {
        ...ownerScope(user),
        ...OPEN_DEAL_WHERE,
        ...(managerId ? { managerId } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        amount: true,
        paidAmount: true,
        createdAt: true,
        dueDate: true,
        client: { select: { id: true, companyName: true, isSvip: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { contractNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const deals = rows
      .map((d) => {
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
          createdAt: d.createdAt,
          dueDate: d.dueDate,
          manager: d.manager ? { id: d.manager.id, fullName: d.manager.fullName } : null,
        };
      })
      // paymentStatus мог отстать от сумм — показываем только реальный остаток.
      .filter((d) => d.remaining > 0.009);

    const todayAgg = await prisma.payment.aggregate({
      where: { paidAt: { gte: tashkentStartOfToday() }, ...cashOnlyFilter },
      _sum: { amount: true },
      _count: true,
    });

    res.json({
      deals,
      totals: {
        remaining: deals.reduce((s, d) => s + d.remaining, 0),
        clientCount: new Set(deals.map((d) => d.clientId)).size,
        todayReceived: Number(todayAgg._sum.amount || 0),
        todayCount: todayAgg._count,
      },
    });
  }),
);

// ──── ЧЕКИ К ПРОБИТИЮ ────
/**
 * Сделки, по которым деньги уже пришли, а чек не отмечен.
 *
 * В старой кассе отметка жила во вкладке «Активные», куда закрытая сделка попадала только
 * в день закрытия, — назавтра забытый чек пропадал из виду. Здесь закрытые держатся
 * неделю: этого хватает, чтобы добить хвосты, и список не зарастает архивом.
 */
const RECEIPT_WINDOW_DAYS = 7;

router.get(
  '/receipts',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const user = authUser(req);
    const since = new Date(tashkentStartOfToday().getTime() - (RECEIPT_WINDOW_DAYS - 1) * 86_400_000);

    const rows = await prisma.deal.findMany({
      where: {
        ...ownerScope(user),
        isArchived: false,
        isReceiptPunched: false,
        paidAmount: { gt: 0 },
        status: { notIn: ['CANCELED', 'REJECTED'] },
        OR: [{ status: { not: 'CLOSED' } }, { closedAt: { gte: since } }],
      },
      select: {
        id: true,
        title: true,
        status: true,
        amount: true,
        paidAmount: true,
        closedAt: true,
        client: { select: { id: true, companyName: true, isSvip: true } },
        manager: { select: { id: true, fullName: true } },
        payments: {
          where: cashOnlyFilter,
          select: { paidAt: true },
          orderBy: { paidAt: 'desc' },
          take: 1,
        },
      },
    });

    const deals = rows
      .map((d) => ({
        dealId: d.id,
        title: d.title,
        status: d.status,
        clientId: d.client.id,
        clientName: d.client.companyName,
        clientIsSvip: !!d.client.isSvip,
        amount: Number(d.amount),
        paidAmount: Number(d.paidAmount),
        closedAt: d.closedAt,
        lastPaymentAt: d.payments[0]?.paidAt ?? null,
        manager: d.manager ? { id: d.manager.id, fullName: d.manager.fullName } : null,
      }))
      // Свежие оплаты — наверх: чек пробивают сразу после приёма денег.
      .sort((a, b) => (b.lastPaymentAt?.getTime() ?? 0) - (a.lastPaymentAt?.getTime() ?? 0));

    res.json({ deals, windowDays: RECEIPT_WINDOW_DAYS });
  }),
);

// ──── КАРТОЧКА КЛИЕНТА ДЛЯ ПАНЕЛИ ОПЛАТЫ ────
router.get(
  '/clients/:clientId',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const user = authUser(req);
    const clientId = req.params.clientId as string;
    const dealScope = ownerScope(user);

    const client = await prisma.client.findFirst({
      where: { id: clientId },
      select: { id: true, companyName: true, contactName: true, phone: true, isSvip: true },
    });
    if (!client) throw new AppError(404, 'Клиент не найден');

    const allDeals = await prisma.deal.findMany({
      where: { clientId, ...dealScope, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
      select: {
        id: true,
        title: true,
        status: true,
        amount: true,
        paidAmount: true,
        createdAt: true,
        manager: { select: { id: true, fullName: true } },
        contract: { select: { contractNumber: true } },
      },
      // Порядок раскладки оплаты: сначала самые старые долги.
      orderBy: { createdAt: 'asc' },
    });

    let prepayment = 0;
    const openDeals = [];
    const creditSources: { dealId: string; title: string | null; surplus: number }[] = [];
    for (const d of allDeals) {
      const amount = Number(d.amount);
      const paidAmount = Number(d.paidAmount);
      const remaining = amount - paidAmount;
      if (remaining < -0.009) {
        prepayment += -remaining;
        creditSources.push({ dealId: d.id, title: d.title, surplus: -remaining });
      }
      if (remaining > 0.009) {
        openDeals.push({
          dealId: d.id,
          title: d.title,
          status: d.status,
          contractNumber: d.contract?.contractNumber ?? null,
          amount,
          paidAmount,
          remaining,
          createdAt: d.createdAt,
          manager: d.manager ? { id: d.manager.id, fullName: d.manager.fullName } : null,
        });
      }
    }

    const recentPayments = await prisma.payment.findMany({
      where: { clientId, deal: dealScope },
      select: {
        id: true,
        amount: true,
        paidAt: true,
        method: true,
        kind: true,
        deal: { select: { id: true, title: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 5,
    });

    res.json({
      client: { ...client, isSvip: !!client.isSvip },
      deals: openDeals,
      totalDebt: openDeals.reduce((s, d) => s + d.remaining, 0),
      prepayment,
      // Порядок списания при зачёте — от большей переплаты, как в apply-client-credit.
      creditSources: creditSources.sort((a, b) => b.surplus - a.surplus),
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paidAt: p.paidAt,
        method: p.method,
        kind: p.kind,
        dealId: p.deal.id,
        dealTitle: p.deal.title,
      })),
    });
  }),
);

// ──── ОПЛАТА ПО КЛИЕНТУ С РАСКЛАДКОЙ ПО СДЕЛКАМ ────
const clientPaymentDto = z.object({
  amount: z.number()
    .positive('Сумма должна быть положительной')
    .max(MAX_PAYMENT_AMOUNT, 'Сумма слишком большая — проверьте, не лишний ли ноль'),
  // В старой кассе способ был необязательным, и такие платежи ломали сверку по методам.
  method: z.enum(['CASH', 'TRANSFER', 'PAYME', 'QR', 'CLICK', 'TERMINAL', 'INSTALLMENT'], {
    errorMap: () => ({ message: 'Выберите способ оплаты' }),
  }),
  /** Сделки, на которые раскладывать; порядок не важен — раскладка всегда от старых к новым. */
  dealIds: z.array(z.string().uuid()).min(1, 'Выберите хотя бы одну сделку'),
  paidAt: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
  receivedById: z.string().uuid().optional(),
  /** Часть суммы, принятая долларами: сколько $ и по какому курсу. amount — полный эквивалент в сумах. */
  usdAmount: z.number().positive().max(10_000_000).optional(),
  usdRate: z.number().positive().max(1_000_000).optional(),
});

/**
 * Делит долларовую часть между платежами по сделкам в том же порядке, что и сумму:
 * доллары заполняют сначала самые старые сделки. Если долларов больше суммы (сдача
 * сумами), лишнее ложится на последний платёж с долларами.
 *
 * Сумма `usdUzs` по платежам совпадает с общей до тийина: из неё касса считает остаток
 * «сумами» (amount − usdUzs). У `usdAmount` последний платёж забирает копеечный остаток.
 */
function splitUsd(part: UsdPart, paymentsCents: number[]): ({ usdAmount: number; usdRate: number; usdUzs: number } | null)[] {
  let leftUzs = toCents(part.usdUzs);
  const uzsShares = paymentsCents.map((cents) => {
    const take = Math.min(cents, leftUzs);
    leftUzs -= take;
    return take;
  });
  if (leftUzs > 0) {
    const lastWithUsd = uzsShares.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0).pop() ?? 0;
    uzsShares[lastWithUsd] += leftUzs;
  }
  const lastIdx = uzsShares.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0).pop();
  let usdLeftCents = toCents(part.usdAmount);
  return uzsShares.map((uzsCents, i) => {
    if (uzsCents <= 0) return null;
    const usdCents = i === lastIdx ? usdLeftCents : Math.round((uzsCents / toCents(part.usdUzs)) * toCents(part.usdAmount));
    usdLeftCents -= usdCents;
    return { usdAmount: fromCents(usdCents), usdRate: part.usdRate, usdUzs: fromCents(uzsCents) };
  });
}

router.post(
  '/clients/:clientId/payments',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const user = authUser(req);
    const clientId = req.params.clientId as string;
    const parsed = clientPaymentDto.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message || 'Некорректные данные');
    const dto = parsed.data;

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt > new Date()) throw new AppError(400, 'Дата оплаты не может быть в будущем');
    // Проверки те же, что у платежа по одной сделке: оба поля и без «лишнего ноля».
    const usdPart = resolveUsdPart(dto.amount, dto.usdAmount, dto.usdRate);

    const result = await prisma.$transaction(async (tx) => {
      let receivedById = user.userId;
      if (dto.receivedById && dto.receivedById !== user.userId) {
        const receiver = await tx.user.findFirst({
          where: { id: dto.receivedById, isActive: true },
          select: { id: true },
        });
        if (!receiver) throw new AppError(404, 'Сотрудник, принявший оплату, не найден');
        receivedById = receiver.id;
      }

      const deals = await tx.deal.findMany({
        where: {
          id: { in: dto.dealIds },
          clientId,
          ...ownerScope(user),
          isArchived: false,
          status: { notIn: ['CANCELED', 'REJECTED'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (deals.length !== new Set(dto.dealIds).size) {
        throw new AppError(404, 'Часть сделок не найдена или недоступна — обновите страницу');
      }

      // Раскладка: каждой сделке — её остаток, от старой к новой. Всё, что больше
      // общего долга, остаётся переплатой на самой новой из выбранных.
      let left = toCents(dto.amount);
      const plan = deals.map((d) => ({ deal: d, cents: 0 }));
      for (const p of plan) {
        if (left <= 0) break;
        const remaining = Math.max(0, toCents(p.deal.amount) - toCents(p.deal.paidAmount));
        const take = Math.min(remaining, left);
        p.cents = take;
        left -= take;
      }
      const overpaymentCents = left;
      if (overpaymentCents > 0) plan[plan.length - 1].cents += overpaymentCents;

      const paying = plan.filter((p) => p.cents > 0);
      const usdShares = usdPart ? splitUsd(usdPart, paying.map((p) => p.cents)) : [];

      const created: { paymentId: string; dealId: string; title: string | null; amount: number; newPaid: number; paymentStatus: PrismaPaymentStatus; usdAmount: number | null }[] = [];
      for (const [i, { deal, cents }] of paying.entries()) {
        const usd = usdShares[i] ?? null;
        const amount = fromCents(cents);
        const newPaid = fromCents(toCents(deal.paidAmount) + cents);
        const paymentStatus = paymentStatusFromAmounts(Number(deal.amount), newPaid);

        const payment = await tx.payment.create({
          data: {
            dealId: deal.id,
            clientId,
            amount,
            ...(usd ?? {}),
            paidAt,
            method: dto.method,
            note: dto.note?.trim() || null,
            kind: 'CASH_IN',
            createdBy: user.userId,
            receivedById,
          },
          select: { id: true },
        });

        const upd = await tx.deal.updateMany({
          where: { id: deal.id, version: deal.version },
          data: { paidAmount: newPaid, paymentStatus, version: { increment: 1 } },
        });
        if (upd.count === 0) {
          throw new AppError(409, `Сделка «${deal.title || deal.id.slice(0, 8)}» изменилась — обновите страницу и повторите.`);
        }

        created.push({ paymentId: payment.id, dealId: deal.id, title: deal.title, amount, newPaid, paymentStatus, usdAmount: usd?.usdAmount ?? null });
      }

      return { created, overpayment: fromCents(overpaymentCents) };
    });

    for (const c of result.created) {
      await auditLog({
        userId: user.userId,
        action: 'PAYMENT_CREATE',
        entityType: 'deal',
        entityId: c.dealId,
        after: {
          paymentId: c.paymentId,
          amount: c.amount,
          newPaidAmount: c.newPaid,
          paymentStatus: c.paymentStatus,
          source: 'cashbox-v2',
          clientTotal: dto.amount,
          ...(c.usdAmount != null ? { usdAmount: c.usdAmount, usdRate: dto.usdRate } : {}),
        },
      });
    }

    // Та же строка в финансовый пост Telegram, что и при обычном платеже по сделке.
    if (hasRole(user, 'ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN')) {
      const actor = await prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
      const contracts = await prisma.deal.findMany({
        where: { id: { in: result.created.map((c) => c.dealId) } },
        select: { id: true, contract: { select: { contractNumber: true } } },
      });
      const contractById = new Map(contracts.map((d) => [d.id, d.contract?.contractNumber?.trim()]));
      const fmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const notePart = dto.note?.trim() ? ` Примечание: ${dto.note.trim()}` : '';
      for (const c of result.created) {
        const line = `${actor?.fullName?.trim() || '—'} добавил(а) платёж ${fmt.format(c.amount)} сум.${notePart} Договор: №${contractById.get(c.dealId) || 'не привязан'}`;
        void storeFinanceTelegramLog(c.dealId, line).catch((err) => {
          console.error('[Telegram deal groups] storeFinanceTelegramLog (cashbox-v2):', err);
        });
      }
    }

    res.status(201).json({
      payments: result.created.map((c) => ({
        paymentId: c.paymentId,
        dealId: c.dealId,
        title: c.title,
        amount: c.amount,
        paymentStatus: c.paymentStatus,
        usdAmount: c.usdAmount,
      })),
      overpayment: result.overpayment,
    });
  }),
);

// ──── ЗАЧЁТ ПЕРЕПЛАТЫ НА СДЕЛКИ КЛИЕНТА ────
/**
 * То же, что `/finance/deals/:dealId/apply-client-credit`, но сразу на несколько сделок:
 * переплата раскладывается на выбранные долги от старых к новым, а списывается с
 * сделок-источников от большей переплаты. Деньги в кассу не поступают — проводки
 * `CREDIT_TRANSFER` в кассовые итоги не входят.
 */
const clientCreditDto = z.object({
  /** Сколько зачесть; без суммы — сколько хватит переплаты, но не больше долга. */
  amount: z.number().positive('Сумма должна быть положительной').max(MAX_PAYMENT_AMOUNT).optional(),
  dealIds: z.array(z.string().uuid()).min(1, 'Выберите хотя бы одну сделку'),
  paidAt: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
});

router.post(
  '/clients/:clientId/apply-credit',
  authorize(...FINANCE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const user = authUser(req);
    const clientId = req.params.clientId as string;
    const parsed = clientCreditDto.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message || 'Некорректные данные');
    const dto = parsed.data;

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt > new Date()) throw new AppError(400, 'Дата оплаты не может быть в будущем');

    const result = await prisma.$transaction(async (tx) => {
      const scope = ownerScope(user);
      const targets = await tx.deal.findMany({
        where: {
          id: { in: dto.dealIds },
          clientId,
          ...scope,
          isArchived: false,
          status: { notIn: ['CANCELED', 'REJECTED'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (targets.length !== new Set(dto.dealIds).size) {
        throw new AppError(404, 'Часть сделок не найдена или недоступна — обновите страницу');
      }

      const sources = (await tx.deal.findMany({
        where: {
          clientId,
          id: { notIn: dto.dealIds },
          ...scope,
          isArchived: false,
          status: { notIn: ['CANCELED', 'REJECTED'] },
        },
        select: { id: true, title: true, amount: true, paidAmount: true, version: true },
      }))
        .map((d) => ({ ...d, surplus: toCents(d.paidAmount) - toCents(d.amount), taken: 0 }))
        .filter((d) => d.surplus > 0)
        .sort((a, b) => b.surplus - a.surplus);

      const pool = sources.reduce((s, d) => s + d.surplus, 0);
      const debt = targets.reduce((s, d) => s + Math.max(0, toCents(d.amount) - toCents(d.paidAmount)), 0);
      const requested = dto.amount != null ? toCents(dto.amount) : Math.min(pool, debt);
      // Переносить переплату туда, где она снова станет переплатой, бессмысленно.
      const applyTotal = Math.min(requested, pool, debt);
      if (applyTotal <= 0) {
        throw new AppError(400, pool <= 0
          ? 'У клиента нет переплаты на других сделках (в вашей зоне видимости)'
          : 'По выбранным сделкам нет долга');
      }

      let left = applyTotal;
      let srcIdx = 0;
      const created: { paymentId: string; dealId: string; title: string | null; amount: number; newPaid: number; sources: { id: string; title: string | null; amount: number }[] }[] = [];

      for (const target of targets) {
        if (left <= 0) break;
        const remaining = Math.max(0, toCents(target.amount) - toCents(target.paidAmount));
        let portion = Math.min(remaining, left);
        if (portion <= 0) continue;
        left -= portion;

        const used: { id: string; title: string | null; amount: number }[] = [];
        const targetCents = portion;
        while (portion > 0) {
          const src = sources[srcIdx];
          const take = Math.min(src.surplus - src.taken, portion);
          src.taken += take;
          portion -= take;
          used.push({ id: src.id, title: src.title, amount: fromCents(take) });
          if (src.taken >= src.surplus) srcIdx += 1;
        }

        const amount = fromCents(targetCents);
        const newPaid = fromCents(toCents(target.paidAmount) + targetCents);
        const upd = await tx.deal.updateMany({
          where: { id: target.id, version: target.version },
          data: {
            paidAmount: newPaid,
            paymentStatus: paymentStatusFromAmounts(Number(target.amount), newPaid),
            version: { increment: 1 },
          },
        });
        if (upd.count === 0) {
          throw new AppError(409, `Сделка «${target.title || target.id.slice(0, 8)}» изменилась — обновите страницу и повторите.`);
        }

        const payment = await tx.payment.create({
          data: {
            dealId: target.id,
            clientId,
            amount,
            paidAt,
            method: 'TRANSFER',
            kind: 'CREDIT_TRANSFER',
            note: buildClientCreditNote(used, dto.note),
            createdBy: user.userId,
          },
          select: { id: true },
        });

        created.push({ paymentId: payment.id, dealId: target.id, title: target.title, amount, newPaid, sources: used });
      }

      // Источники списываем одним обновлением на сделку, даже если она кормила несколько долгов.
      for (const src of sources) {
        if (src.taken <= 0) continue;
        const newPaid = fromCents(toCents(src.paidAmount) - src.taken);
        const upd = await tx.deal.updateMany({
          where: { id: src.id, version: src.version },
          data: {
            paidAmount: newPaid,
            paymentStatus: paymentStatusFromAmounts(Number(src.amount), newPaid),
            version: { increment: 1 },
          },
        });
        if (upd.count === 0) {
          throw new AppError(409, 'Сделка-источник была изменена. Обновите страницу и повторите.');
        }
      }

      return { created, applied: fromCents(applyTotal), requested: fromCents(requested) };
    });

    // Формат совпадает с apply-client-credit: по `paymentId` и `sources` из этой записи
    // работает сторнирование зачёта (reverse-client-credit).
    for (const c of result.created) {
      await auditLog({
        userId: user.userId,
        action: 'PAYMENT_CREATE',
        entityType: 'deal',
        entityId: c.dealId,
        after: {
          paymentId: c.paymentId,
          kind: 'CLIENT_CREDIT_APPLY',
          amount: c.amount,
          newPaidAmount: c.newPaid,
          sources: c.sources,
          source: 'cashbox-v2',
        },
      });
    }

    res.status(201).json({
      payments: result.created.map((c) => ({ paymentId: c.paymentId, dealId: c.dealId, title: c.title, amount: c.amount })),
      appliedAmount: result.applied,
      requestedAmount: result.requested,
      partiallyApplied: result.applied + 0.01 < result.requested,
    });
  }),
);

export { router as cashboxV2Routes };
