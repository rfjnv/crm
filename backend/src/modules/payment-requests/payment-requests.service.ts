import { Prisma, PaymentRequestStatus, Role } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { hasRole, userRolesWhere } from '../../lib/roles';
import { ownerScope, type AuthUser } from '../../lib/scope';
import { TASHKENT_OFFSET_MS, tashkentDayKey } from '../../lib/tz';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';
import { MAX_PAYMENT_AMOUNT } from '../deals/deals.dto';
import { planAllocation, toCents, type AllocationSource, type PlanDeal } from './payment-requests.plan';

/**
 * Заявка на оплату: менеджер собирает товары за период и отправляет бухгалтеру. Бухгалтер
 * принимает — на сделки клиента добавляются оплаты. Сами сделки (позиции, цены, способ
 * оплаты) не меняются, у них двигаются только paidAmount и paymentStatus.
 */

export const DECIDE_ROLES: Role[] = ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'];
const PAGE_LINK = '/finance/payment-requests';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД');
const METHODS = ['TRANSFER', 'CASH', 'PAYME', 'QR', 'CLICK', 'TERMINAL'] as const;

export const createPaymentRequestDto = z.object({
  clientId: z.string().uuid(),
  from: dateString,
  to: dateString,
  method: z.enum(METHODS).default('TRANSFER'),
  note: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    qty: z.number().positive('Количество должно быть больше нуля').max(1_000_000),
    price: z.number().positive('Цена должна быть больше нуля').max(1_000_000_000),
  })).min(1, 'Добавьте хотя бы один товар').max(200),
});
export type CreatePaymentRequestDto = z.infer<typeof createPaymentRequestDto>;

export const acceptPaymentRequestDto = z.object({
  paidAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
});
export const rejectPaymentRequestDto = z.object({
  reason: z.string().trim().min(3, 'Укажите причину (мин. 3 символа)').max(500),
});

/** Границы периода: начало первого дня и начало дня после последнего, по Ташкенту. */
function periodBounds(from: string, to: string) {
  const start = new Date(new Date(`${from}T00:00:00.000Z`).getTime() - TASHKENT_OFFSET_MS);
  const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() - TASHKENT_OFFSET_MS + 24 * 60 * 60 * 1000);
  return { start, end };
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const money = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);

const DEAL_SELECT = {
  id: true,
  title: true,
  amount: true,
  paidAmount: true,
  version: true,
  clientId: true,
  createdAt: true,
  items: {
    select: { productId: true, requestedQty: true, price: true, lineTotal: true, dealDate: true, createdAt: true },
  },
} satisfies Prisma.DealSelect;
type DealRow = Prisma.DealGetPayload<{ select: typeof DEAL_SELECT }>;

const itemValue = (item: DealRow['items'][number]) => {
  if (item.lineTotal != null) return money(item.lineTotal);
  return money(item.requestedQty) * money(item.price);
};

/** Позиции сделки, чья дата попала в период. У позиции своя дата, если она задана. */
function itemsInPeriod(deal: DealRow, start: Date, end: Date) {
  return deal.items.filter((item) => {
    const at = item.dealDate ?? deal.createdAt;
    return at >= start && at < end;
  });
}

function toPlanDeal(deal: DealRow, start: Date, end: Date): PlanDeal {
  const items = itemsInPeriod(deal, start, end);
  const times = items.map((i) => (i.dealDate ?? deal.createdAt).getTime());
  return {
    id: deal.id,
    at: times.length ? Math.min(...times) : deal.createdAt.getTime(),
    debtCents: toCents(money(deal.amount)) - toCents(money(deal.paidAmount)),
    items: items.map((i) => ({ productId: i.productId, cents: toCents(itemValue(i)) })),
  };
}

const LIVE_DEAL_WHERE = {
  isArchived: false,
  status: { notIn: ['CANCELED', 'REJECTED'] },
} satisfies Prisma.DealWhereInput;

const REQUEST_INCLUDE = {
  client: { select: { id: true, companyName: true } },
  createdBy: { select: { id: true, fullName: true } },
  decidedBy: { select: { id: true, fullName: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
  payments: {
    select: { id: true, amount: true, deal: { select: { id: true, title: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PaymentRequestInclude;
type RequestRow = Prisma.PaymentRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

function present(r: RequestRow) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    client: r.client,
    from: dayOf(r.periodFrom),
    to: dayOf(r.periodTo),
    method: r.method,
    amount: money(r.amount),
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    paidAt: r.paidAt,
    items: r.items.map((i) => ({
      id: i.id,
      product: i.product,
      qty: money(i.qty),
      price: money(i.price),
      lineTotal: money(i.lineTotal),
    })),
    payments: r.payments.map((p) => ({ id: p.id, amount: money(p.amount), deal: p.deal })),
  };
}

async function notifyAccountants(title: string, body: string, createdByUserId: string) {
  const accountants = await prisma.user.findMany({
    where: { ...userRolesWhere(['ACCOUNTANT']), isActive: true, id: { not: createdByUserId } },
    select: { id: true },
  });
  if (accountants.length === 0) return;
  await prisma.notification.createMany({
    data: accountants.map((u) => ({ userId: u.id, title, body, severity: 'INFO' as const, link: PAGE_LINK, createdByUserId })),
  });
  pushService.sendPushToRoles(['ACCOUNTANT'], { title, body, url: PAGE_LINK, severity: 'INFO' }).catch(() => {});
  telegramService.sendToRoles(['ACCOUNTANT'], { title, body, url: PAGE_LINK, severity: 'INFO' }).catch(() => {});
}

async function notifyCreator(request: { createdById: string }, title: string, body: string, actorId: string) {
  if (request.createdById === actorId) return;
  await prisma.notification.create({
    data: { userId: request.createdById, title, body, severity: 'INFO', link: PAGE_LINK, createdByUserId: actorId },
  });
}

const canDecide = (user: AuthUser) => hasRole(user, ...DECIDE_ROLES);
const moneyText = (v: number) => new Intl.NumberFormat('ru-RU').format(v);

async function loadPlan(db: Prisma.TransactionClient | typeof prisma, request: {
  clientId: string; periodFrom: Date; periodTo: Date; items: { productId: string; lineTotal: Prisma.Decimal }[];
}) {
  const { start, end } = periodBounds(dayOf(request.periodFrom), dayOf(request.periodTo));
  const deals = await db.deal.findMany({
    where: { clientId: request.clientId, ...LIVE_DEAL_WHERE },
    select: DEAL_SELECT,
  });
  const plan = planAllocation(
    request.items.map((i) => ({ productId: i.productId, cents: toCents(money(i.lineTotal)) })),
    deals.map((d) => toPlanDeal(d, start, end)),
  );
  return { deals, plan, start, end };
}

export const paymentRequestsService = {
  /** Что клиент купил за период — из этого менеджер собирает заявку. */
  async available(clientId: string, from: string, to: string, user: AuthUser) {
    if (from > to) throw new AppError(400, 'Начало периода позже конца');
    const { start, end } = periodBounds(from, to);
    const deals = await prisma.deal.findMany({
      where: {
        clientId,
        ...LIVE_DEAL_WHERE,
        ...ownerScope(user),
        OR: [
          { createdAt: { gte: start, lt: end } },
          { items: { some: { dealDate: { gte: start, lt: end } } } },
        ],
      },
      select: DEAL_SELECT,
    });

    const byProduct = new Map<string, { qty: number; value: number; lastPrice: number; lastAt: number }>();
    let periodDebt = 0;
    let dealsInPeriod = 0;
    for (const deal of deals) {
      const items = itemsInPeriod(deal, start, end);
      if (items.length === 0) continue;
      dealsInPeriod += 1;
      periodDebt += Math.max(0, money(deal.amount) - money(deal.paidAmount));
      for (const item of items) {
        const row = byProduct.get(item.productId) ?? { qty: 0, value: 0, lastPrice: 0, lastAt: 0 };
        const at = (item.dealDate ?? deal.createdAt).getTime();
        row.qty += money(item.requestedQty);
        row.value += itemValue(item);
        if (item.price != null && at >= row.lastAt) {
          row.lastPrice = money(item.price);
          row.lastAt = at;
        }
        byProduct.set(item.productId, row);
      }
    }

    // Уже собрано в других заявках за пересекающийся период — чтобы не оплатить товар дважды.
    const others = await prisma.paymentRequestItem.groupBy({
      by: ['productId'],
      where: {
        request: {
          clientId,
          status: { in: ['PENDING', 'ACCEPTED'] },
          periodFrom: { lte: new Date(`${to}T00:00:00.000Z`) },
          periodTo: { gte: new Date(`${from}T00:00:00.000Z`) },
        },
      },
      _sum: { qty: true },
    });
    const requested = new Map(others.map((o) => [o.productId, money(o._sum.qty)]));

    const products = await prisma.product.findMany({
      where: { id: { in: [...new Set([...byProduct.keys(), ...requested.keys()])] } },
      select: { id: true, name: true, sku: true, unit: true },
    });
    const rows = products.map((p) => {
      const row = byProduct.get(p.id);
      return {
        product: p,
        boughtQty: row?.qty ?? 0,
        boughtValue: row?.value ?? 0,
        price: row?.lastPrice ?? 0,
        requestedQty: requested.get(p.id) ?? 0,
      };
    })
      // Позиция без количества (ещё не подтверждена складом) собирать нечего
      .filter((r) => r.boughtQty > 0 || r.requestedQty > 0)
      .sort((a, b) => a.product.sku.localeCompare(b.product.sku, 'ru', { numeric: true }));

    return { rows, periodDebt, dealsInPeriod };
  },

  async list(status: PaymentRequestStatus | undefined, user: AuthUser) {
    const rows = await prisma.paymentRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(canDecide(user) ? {} : { createdById: user.userId }),
      },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(present);
  },

  async pendingCount() {
    return prisma.paymentRequest.count({ where: { status: 'PENDING' } });
  },

  async create(dto: CreatePaymentRequestDto, user: AuthUser) {
    if (dto.from > dto.to) throw new AppError(400, 'Начало периода позже конца');
    const client = await prisma.client.findFirst({
      where: { id: dto.clientId, isArchived: false },
      select: { id: true, companyName: true },
    });
    if (!client) throw new AppError(404, 'Клиент не найден');

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const found = await prisma.product.count({ where: { id: { in: productIds } } });
    if (found !== productIds.length) throw new AppError(404, 'Товар не найден');

    const lines = dto.items.map((i) => ({
      ...i,
      lineTotal: Math.round(i.qty * i.price * 100) / 100,
    }));
    const amount = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
    if (amount > MAX_PAYMENT_AMOUNT) throw new AppError(400, 'Сумма слишком большая — проверьте, не лишний ли ноль');

    const created = await prisma.paymentRequest.create({
      data: {
        clientId: dto.clientId,
        periodFrom: new Date(`${dto.from}T00:00:00.000Z`),
        periodTo: new Date(`${dto.to}T00:00:00.000Z`),
        method: dto.method,
        amount,
        note: dto.note || null,
        createdById: user.userId,
        items: { create: lines },
      },
      include: REQUEST_INCLUDE,
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'payment_request',
      entityId: created.id,
      after: { number: created.number, clientId: dto.clientId, amount, from: dto.from, to: dto.to },
    });
    void notifyAccountants(
      `Заявка на оплату №${created.number}`,
      `${client.companyName}: ${moneyText(amount)} сум за ${dto.from} — ${dto.to}. От: ${created.createdBy.fullName}`,
      user.userId,
    ).catch((err) => console.error('[payment-requests] notify:', err));

    return present(created);
  },

  /** Что произойдёт при подтверждении. Ничего не записывает. */
  async preview(id: string) {
    const request = await prisma.paymentRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!request) throw new AppError(404, 'Заявка не найдена');
    const { deals, plan, start, end } = await loadPlan(prisma, request);
    const dealById = new Map(deals.map((d) => [d.id, d]));

    const bought = new Map<string, number>();
    for (const deal of deals) {
      for (const item of itemsInPeriod(deal, start, end)) {
        bought.set(item.productId, (bought.get(item.productId) ?? 0) + money(item.requestedQty));
      }
    }

    return {
      request: present(request),
      lines: request.items.map((i) => ({
        product: i.product,
        qty: money(i.qty),
        price: money(i.price),
        lineTotal: money(i.lineTotal),
        boughtQty: bought.get(i.productId) ?? 0,
      })),
      allocations: plan.allocations.map((a) => {
        const deal = dealById.get(a.dealId)!;
        return {
          deal: { id: deal.id, title: deal.title, date: tashkentDayKey(deal.createdAt) },
          debt: money(deal.amount) - money(deal.paidAmount),
          amount: a.cents / 100,
          source: a.source as AllocationSource,
        };
      }),
      unallocated: plan.unallocatedCents / 100,
    };
  },

  async accept(id: string, dto: z.infer<typeof acceptPaymentRequestDto>, user: AuthUser) {
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt > new Date()) throw new AppError(400, 'Дата оплаты не может быть в будущем');

    const result = await prisma.$transaction(async (tx) => {
      // Условный переход статуса: второй бухгалтер не проведёт ту же заявку повторно.
      const claimed = await tx.paymentRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'ACCEPTED',
          decidedById: user.userId,
          decidedAt: new Date(),
          decisionNote: dto.note || null,
          paidAt,
        },
      });
      if (claimed.count === 0) throw new AppError(409, 'Заявка уже обработана. Обновите страницу.');

      const request = await tx.paymentRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
      const { deals, plan } = await loadPlan(tx, request);
      if (plan.unallocatedCents > 0) {
        throw new AppError(
          400,
          `Сумма заявки больше долга клиента на ${moneyText(plan.unallocatedCents / 100)} сум. Проверьте заявку.`,
        );
      }

      const dealById = new Map(deals.map((d) => [d.id, d]));
      const posted: { dealId: string; paymentId: string; amount: number; paid: number; status: string }[] = [];
      for (const allocation of plan.allocations) {
        const deal = dealById.get(allocation.dealId)!;
        const amount = allocation.cents / 100;
        const paid = (toCents(money(deal.paidAmount)) + allocation.cents) / 100;
        const paymentStatus = paid >= money(deal.amount) ? 'PAID' : 'PARTIAL';
        const payment = await tx.payment.create({
          data: {
            dealId: deal.id,
            clientId: deal.clientId,
            amount,
            paidAt,
            method: request.method,
            note: `Заявка на оплату №${request.number}${dto.note ? `: ${dto.note}` : ''}`.slice(0, 500),
            kind: 'CASH_IN',
            createdBy: user.userId,
            receivedById: user.userId,
            paymentRequestId: id,
          },
        });
        const updated = await tx.deal.updateMany({
          where: { id: deal.id, version: deal.version },
          data: { paidAmount: paid, paymentStatus, version: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw new AppError(409, 'Сделка изменилась во время проведения. Попробуйте ещё раз.');
        }
        posted.push({ dealId: deal.id, paymentId: payment.id, amount, paid, status: paymentStatus });
      }

      return { posted, request: await tx.paymentRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE }) };
    }, { timeout: 30_000 });

    await Promise.all(result.posted.map((p) => auditLog({
      userId: user.userId,
      action: 'PAYMENT_CREATE',
      entityType: 'deal',
      entityId: p.dealId,
      after: { paymentId: p.paymentId, amount: p.amount, newPaidAmount: p.paid, paymentStatus: p.status, paymentRequestId: id },
    })));
    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'payment_request',
      entityId: id,
      after: { deals: result.posted.length, amount: money(result.request.amount) },
    });
    void notifyCreator(
      result.request,
      `Заявка на оплату №${result.request.number} принята`,
      `${result.request.client.companyName}: ${moneyText(money(result.request.amount))} сум`,
      user.userId,
    ).catch((err) => console.error('[payment-requests] notify:', err));

    return present(result.request);
  },

  async reject(id: string, reason: string, user: AuthUser) {
    const claimed = await prisma.paymentRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById: user.userId, decidedAt: new Date(), decisionNote: reason },
    });
    if (claimed.count === 0) throw new AppError(409, 'Заявка уже обработана. Обновите страницу.');
    const request = await prisma.paymentRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'payment_request',
      entityId: id,
      after: { reason },
    });
    void notifyCreator(request, `Заявка на оплату №${request.number} отклонена`, reason, user.userId)
      .catch((err) => console.error('[payment-requests] notify:', err));
    return present(request);
  },

  /** Отозвать может только автор и только пока бухгалтер не решил. */
  async cancel(id: string, user: AuthUser) {
    const claimed = await prisma.paymentRequest.updateMany({
      where: { id, status: 'PENDING', createdById: user.userId },
      data: { status: 'CANCELED' },
    });
    if (claimed.count === 0) throw new AppError(409, 'Отозвать можно только свою заявку на рассмотрении.');
    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'payment_request',
      entityId: id,
    });
    return present(await prisma.paymentRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE }));
  },
};
