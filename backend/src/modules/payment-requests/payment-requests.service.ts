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
import { recordPaidChanges } from '../accounting-changes/accounting-changes.service';
import { setDealDocsReady } from '../deals/deals.docs-ready';
import { postPaymentRequestToGroup, updatePaymentRequestPost } from './payment-requests.telegram';
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
/** Те же документы, что менеджер отмечает у сделки на перечисление. */
export const TRANSFER_DOCUMENTS = ['Договор', 'Спецификация', 'Счет', 'Счет-фактура', 'Накладная'] as const;

export const createPaymentRequestDto = z.object({
  clientId: z.string().uuid(),
  /** Заявка по одной сделке: период не нужен, количество берётся из её позиций. */
  dealId: z.string().uuid().optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  method: z.enum(METHODS).default('TRANSFER'),
  note: z.string().trim().max(500).optional(),
  transferInn: z.string().trim().max(50).optional(),
  transferDocuments: z.array(z.enum(TRANSFER_DOCUMENTS)).max(10).optional(),
  transferType: z.enum(['ONE_TIME', 'ANNUAL']).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    dealItemId: z.string().uuid().optional(),
    qty: z.number().positive('Количество должно быть больше нуля').max(1_000_000),
    price: z.number().positive('Цена должна быть больше нуля').max(1_000_000_000),
  })).min(1, 'Добавьте хотя бы один товар').max(200),
}).refine((d) => d.dealId || (d.from && d.to), { message: 'Укажите период или сделку', path: ['from'] })
  .refine((d) => d.method !== 'TRANSFER' || (d.transferInn ?? '').length >= 3, {
    message: 'Для перечисления укажите ИНН компании', path: ['transferInn'],
  })
  .refine((d) => d.method !== 'TRANSFER' || (d.transferDocuments?.length ?? 0) > 0, {
    message: 'Для перечисления выберите хотя бы один документ', path: ['transferDocuments'],
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
    select: { id: true, productId: true, requestedQty: true, price: true, lineTotal: true, dealDate: true, createdAt: true },
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
  deal: { select: { id: true, title: true } },
  createdBy: { select: { id: true, fullName: true } },
  decidedBy: { select: { id: true, fullName: true } },
  docsReadyBy: { select: { id: true, fullName: true } },
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
    deal: r.deal,
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
    transferInn: r.transferInn,
    transferDocuments: r.transferDocuments,
    transferType: r.transferType,
    docsReadyAt: r.docsReadyAt,
    docsReadyBy: r.docsReadyBy,
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

/** Для заявки по сделке период не ограничивает: в расчёт идут все позиции сделки. */
const ALL_TIME = { start: new Date(0), end: new Date('3000-01-01T00:00:00.000Z') };

async function loadPlan(db: Prisma.TransactionClient | typeof prisma, request: {
  clientId: string; dealId: string | null; periodFrom: Date; periodTo: Date;
  items: { productId: string; lineTotal: Prisma.Decimal }[];
}) {
  // Заявка по сделке ложится только на эту сделку: лишнее не уходит на другие долги клиента.
  const { start, end } = request.dealId ? ALL_TIME : periodBounds(dayOf(request.periodFrom), dayOf(request.periodTo));
  const deals = await db.deal.findMany({
    where: request.dealId
      ? { id: request.dealId, clientId: request.clientId, ...LIVE_DEAL_WHERE }
      : { clientId: request.clientId, ...LIVE_DEAL_WHERE },
    select: DEAL_SELECT,
  });
  const plan = planAllocation(
    request.items.map((i) => ({ productId: i.productId, cents: toCents(money(i.lineTotal)) })),
    deals.map((d) => toPlanDeal(d, start, end)),
  );
  return { deals, plan, start, end };
}

/** Реквизиты перечисления сохраняем только для перечисления. */
function transferFields(dto: CreatePaymentRequestDto) {
  if (dto.method !== 'TRANSFER') return {};
  return {
    transferInn: dto.transferInn || null,
    transferDocuments: [...new Set(dto.transferDocuments ?? [])],
    transferType: dto.transferType ?? 'ONE_TIME',
  };
}

/** Сколько по каждой позиции сделки уже в заявках на рассмотрении и принятых. */
async function requestedByDealItem(db: Prisma.TransactionClient | typeof prisma, dealItemIds: string[]) {
  if (dealItemIds.length === 0) return new Map<string, number>();
  const rows = await db.paymentRequestItem.groupBy({
    by: ['dealItemId'],
    where: { dealItemId: { in: dealItemIds }, request: { status: { in: ['PENDING', 'ACCEPTED'] } } },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.dealItemId as string, money(r._sum.qty)]));
}

async function announceCreated(created: RequestRow, scopeText: string, user: AuthUser) {
  const amount = money(created.amount);
  await auditLog({
    userId: user.userId,
    action: 'CREATE',
    entityType: 'payment_request',
    entityId: created.id,
    after: {
      number: created.number,
      clientId: created.client.id,
      dealId: created.deal?.id ?? null,
      amount,
      from: dayOf(created.periodFrom),
      to: dayOf(created.periodTo),
    },
  });
  void notifyAccountants(
    `Заявка на оплату №${created.number}`,
    `${created.client.companyName}: ${moneyText(amount)} сум ${scopeText}. От: ${created.createdBy.fullName}`,
    user.userId,
  ).catch((err) => console.error('[payment-requests] notify:', err));
  void postPaymentRequestToGroup(created.id).catch((err) => console.error('[payment-requests] group post:', err));
}

/**
 * Документы по заявке на перечисление готовы — значит, готовы и по её сделкам. Сделка на
 * перечисление ждёт отметки «Документы готовы» до групп производства и отгрузки, а отметка
 * в заявке её раньше не снимала: сделка так и не попадала в группу. Ставим отметку сделкам,
 * на которые ляжет оплата (по сделке — на неё саму), и отправляем их в группы.
 */
async function markRequestDealsDocsReady(request: RequestRow, user: AuthUser) {
  const dealIds = request.dealId
    ? [request.dealId]
    : [...new Set((await loadPlan(prisma, request)).plan.allocations.map((a) => a.dealId))];
  if (dealIds.length === 0) return;
  const deals = await prisma.deal.findMany({
    where: { id: { in: dealIds }, paymentMethod: 'TRANSFER', docsReadyAt: null },
    select: { id: true },
  });
  for (const deal of deals) {
    await setDealDocsReady(deal.id, true, user).catch((err) =>
      console.error('[payment-requests] deal docs-ready:', deal.id, err),
    );
  }
}

const refreshGroupPost = (id: string) =>
  void updatePaymentRequestPost(id).catch((err) => console.error('[payment-requests] group post update:', err));

const qtyText = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(v);

/**
 * Заявка по одной сделке, в том числе не закрытой: менеджер берёт часть количества из позиций
 * (например, 4 000 из 10 400 листов), и оплата потом ложится только на эту сделку.
 * Цена берётся из сделки, количество не больше того, что ещё не попало в другие заявки.
 */
async function createForDeal(dto: CreatePaymentRequestDto, dealId: string, user: AuthUser) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, clientId: dto.clientId, ...LIVE_DEAL_WHERE, ...ownerScope(user) },
    select: DEAL_SELECT,
  });
  if (!deal) throw new AppError(404, 'Сделка не найдена');

  const itemById = new Map(deal.items.map((i) => [i.id, i]));
  const requested = await requestedByDealItem(prisma, deal.items.map((i) => i.id));
  const taken = new Map<string, number>();
  const lines = dto.items.map((line) => {
    const item = line.dealItemId ? itemById.get(line.dealItemId) : undefined;
    if (!item || item.productId !== line.productId) throw new AppError(400, 'Позиция не из этой сделки');
    const price = money(item.price);
    if (price <= 0) throw new AppError(400, 'У позиции сделки нет цены');
    const free = money(item.requestedQty) - (requested.get(item.id) ?? 0) - (taken.get(item.id) ?? 0);
    if (line.qty > free + 1e-9) {
      throw new AppError(400, `По позиции можно оплатить не больше ${qtyText(Math.max(0, free))}`);
    }
    taken.set(item.id, (taken.get(item.id) ?? 0) + line.qty);
    return {
      productId: item.productId,
      dealItemId: item.id,
      qty: line.qty,
      price,
      lineTotal: Math.round(line.qty * price * 100) / 100,
    };
  });

  const amount = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
  const debt = money(deal.amount) - money(deal.paidAmount);
  if (toCents(amount) > toCents(debt)) {
    throw new AppError(400, `Сумма заявки больше долга по сделке (${moneyText(Math.max(0, debt))} сум)`);
  }

  const days = deal.items
    .filter((i) => taken.has(i.id))
    .map((i) => tashkentDayKey(i.dealDate ?? deal.createdAt))
    .sort();
  const created = await prisma.paymentRequest.create({
    data: {
      clientId: dto.clientId,
      dealId,
      periodFrom: new Date(`${days[0]}T00:00:00.000Z`),
      periodTo: new Date(`${days[days.length - 1]}T00:00:00.000Z`),
      method: dto.method,
      amount,
      note: dto.note || null,
      ...transferFields(dto),
      createdById: user.userId,
      items: { create: lines },
    },
    include: REQUEST_INCLUDE,
  });

  await announceCreated(created, `по сделке «${deal.title}»`, user);
  return present(created);
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

  /** Сделки клиента с долгом, в том числе не закрытые: из них можно собрать заявку по сделке. */
  async dealOptions(clientId: string, user: AuthUser) {
    const deals = await prisma.deal.findMany({
      where: { clientId, ...LIVE_DEAL_WHERE, ...ownerScope(user) },
      select: {
        id: true, title: true, status: true, amount: true, paidAmount: true, paymentStatus: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return deals
      // Не закрытая сделка без количества (ждёт склада) имеет сумму 0 — её тоже показываем,
      // иначе менеджер не понимает, куда она делась. Скрываем только оплаченные.
      .filter((d) => d.paymentStatus !== 'PAID' && money(d.amount) - money(d.paidAmount) >= 0)
      .filter((d) => money(d.amount) > money(d.paidAmount) || money(d.amount) === 0)
      .map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        date: tashkentDayKey(d.createdAt),
        amount: money(d.amount),
        debt: Math.max(0, money(d.amount) - money(d.paidAmount)),
      }))
      .slice(0, 100);
  },

  /** Позиции сделки: сколько в ней каждого товара и сколько уже попало в заявки. */
  async dealGoods(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...LIVE_DEAL_WHERE, ...ownerScope(user) },
      select: {
        id: true,
        title: true,
        status: true,
        amount: true,
        paidAmount: true,
        createdAt: true,
        transferInn: true,
        client: { select: { id: true, companyName: true, inn: true } },
        items: {
          select: {
            id: true,
            requestedQty: true,
            price: true,
            lineTotal: true,
            product: { select: { id: true, name: true, sku: true, unit: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена');

    const requested = await requestedByDealItem(prisma, deal.items.map((i) => i.id));
    const pending = await prisma.paymentRequest.aggregate({
      where: { dealId, status: 'PENDING' },
      _sum: { amount: true },
    });

    return {
      deal: {
        id: deal.id,
        title: deal.title,
        status: deal.status,
        date: tashkentDayKey(deal.createdAt),
        client: deal.client,
        amount: money(deal.amount),
        paid: money(deal.paidAmount),
        debt: Math.max(0, money(deal.amount) - money(deal.paidAmount)),
        pendingAmount: money(pending._sum.amount),
        inn: deal.transferInn?.trim() || deal.client.inn?.trim() || null,
      },
      lines: deal.items
        // Позиции без количества или цены тоже показываем: оплатить их пока нельзя, но видно почему.
        .map((i) => ({
          dealItemId: i.id,
          product: i.product,
          qty: money(i.requestedQty),
          price: money(i.price),
          lineTotal: i.lineTotal != null ? money(i.lineTotal) : money(i.requestedQty) * money(i.price),
          requestedQty: requested.get(i.id) ?? 0,
        })),
    };
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
    if (dto.dealId) return createForDeal(dto, dto.dealId, user);
    const from = dto.from!;
    const to = dto.to!;
    if (from > to) throw new AppError(400, 'Начало периода позже конца');
    const client = await prisma.client.findFirst({
      where: { id: dto.clientId, isArchived: false },
      select: { id: true, companyName: true },
    });
    if (!client) throw new AppError(404, 'Клиент не найден');

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const found = await prisma.product.count({ where: { id: { in: productIds } } });
    if (found !== productIds.length) throw new AppError(404, 'Товар не найден');

    const lines = dto.items.map((i) => ({
      productId: i.productId,
      qty: i.qty,
      price: i.price,
      lineTotal: Math.round(i.qty * i.price * 100) / 100,
    }));
    const amount = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
    if (amount > MAX_PAYMENT_AMOUNT) throw new AppError(400, 'Сумма слишком большая — проверьте, не лишний ли ноль');

    const created = await prisma.paymentRequest.create({
      data: {
        clientId: dto.clientId,
        periodFrom: new Date(`${from}T00:00:00.000Z`),
        periodTo: new Date(`${to}T00:00:00.000Z`),
        method: dto.method,
        amount,
        note: dto.note || null,
        ...transferFields(dto),
        createdById: user.userId,
        items: { create: lines },
      },
      include: REQUEST_INCLUDE,
    });

    await announceCreated(created, `за ${from} — ${to}`, user);
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
        // По перечислению сначала документы, потом оплата — как у сделок.
        where: { id, status: 'PENDING', OR: [{ method: { not: 'TRANSFER' } }, { docsReadyAt: { not: null } }] },
        data: {
          status: 'ACCEPTED',
          decidedById: user.userId,
          decidedAt: new Date(),
          decisionNote: dto.note || null,
          paidAt,
        },
      });
      if (claimed.count === 0) {
        const current = await tx.paymentRequest.findUnique({ where: { id }, select: { status: true } });
        if (current?.status === 'PENDING') {
          throw new AppError(400, 'По перечислению сначала сделайте документы и отметьте «Документы готовы».');
        }
        throw new AppError(409, 'Заявка уже обработана. Обновите страницу.');
      }

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
    recordPaidChanges(result.posted.map((p) => ({ dealId: p.dealId, delta: p.amount })), user);
    void notifyCreator(
      result.request,
      `Заявка на оплату №${result.request.number} принята`,
      `${result.request.client.companyName}: ${moneyText(money(result.request.amount))} сум`,
      user.userId,
    ).catch((err) => console.error('[payment-requests] notify:', err));
    refreshGroupPost(id);

    return present(result.request);
  },

  /** Бухгалтер сделал документы по перечислению; оплату примет, когда деньги придут. */
  async docsReady(id: string, user: AuthUser) {
    const claimed = await prisma.paymentRequest.updateMany({
      where: { id, status: 'PENDING', method: 'TRANSFER', docsReadyAt: null },
      data: { docsReadyAt: new Date(), docsReadyById: user.userId },
    });
    if (claimed.count === 0) throw new AppError(409, 'Заявка уже изменилась. Обновите страницу.');
    const request = await prisma.paymentRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'payment_request',
      entityId: id,
      after: { docsReady: true },
    });
    void notifyCreator(
      request,
      `Документы по заявке №${request.number} готовы`,
      `${request.client.companyName}: ждём оплату ${moneyText(money(request.amount))} сум`,
      user.userId,
    ).catch((err) => console.error('[payment-requests] notify:', err));
    void markRequestDealsDocsReady(request, user).catch((err) =>
      console.error('[payment-requests] deals docs-ready:', err),
    );
    refreshGroupPost(id);
    return present(request);
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
    refreshGroupPost(id);
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
    refreshGroupPost(id);
    return present(await prisma.paymentRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE }));
  },
};
