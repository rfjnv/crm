import type { NextFunction, Request, Response } from 'express';
import { DealStatus, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { hasRole, userRolesWhere } from '../../lib/roles';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';

/**
 * Изменения сделок на перечисление, которые касаются бухгалтерии.
 *
 * Бухгалтер делает документы (счёт-фактура, акт сверки, договор) по сделке, а потом
 * менеджер даёт скидку или меняет количество — и документы молча расходятся со сделкой.
 * Поэтому каждый изменяющий запрос к сделке сравнивает её «бухгалтерский вид» до и после;
 * если что-то поменялось, запись попадает на страницу «Изменения в сделках» и бухгалтерам
 * приходит уведомление.
 */

/** До этих статусов сделка у бухгалтера ещё не была — правки менеджера тут обычная работа. */
const NOT_YET_AT_ACCOUNTANT: DealStatus[] = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_STOCK_CONFIRMATION',
  'STOCK_CONFIRMED',
  'CANCELED',
  'REJECTED',
];

export interface AccountingSnapshotItem {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
}

export interface AccountingSnapshot {
  title: string;
  status: DealStatus;
  paymentMethod: string | null;
  amount: number;
  discount: number;
  includeVat: boolean;
  items: AccountingSnapshotItem[];
}

export type AccountingChangeKind = 'price' | 'qty' | 'added' | 'removed' | 'amount' | 'discount' | 'vat' | 'paymentMethod';

export interface AccountingChangeLine {
  kind: AccountingChangeKind;
  product?: string;
  unit?: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

const num = (v: Prisma.Decimal | number | null | undefined) => Math.round(Number(v ?? 0) * 1000) / 1000;

export async function takeAccountingSnapshot(dealId: string): Promise<AccountingSnapshot | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      title: true,
      status: true,
      paymentMethod: true,
      amount: true,
      discount: true,
      includeVat: true,
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          productId: true,
          requestedQty: true,
          price: true,
          product: { select: { name: true, unit: true } },
        },
      },
    },
  });
  if (!deal) return null;
  return {
    title: deal.title,
    status: deal.status,
    paymentMethod: deal.paymentMethod,
    amount: num(deal.amount),
    discount: num(deal.discount),
    includeVat: deal.includeVat,
    items: deal.items.map((i) => ({
      productId: i.productId,
      name: i.product.name,
      unit: i.product.unit,
      qty: num(i.requestedQty),
      price: num(i.price),
    })),
  };
}

/** Строки одного товара: в сделке товар может стоять несколькими позициями. */
function groupByProduct(items: AccountingSnapshotItem[]) {
  const map = new Map<string, AccountingSnapshotItem[]>();
  for (const it of items) {
    const list = map.get(it.productId) ?? [];
    list.push(it);
    map.set(it.productId, list);
  }
  return map;
}

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 1000) / 1000;
const priceKey = (xs: AccountingSnapshotItem[]) => [...new Set(xs.map((x) => x.price))].sort((a, b) => a - b);

/** Что поменялось для бухгалтерии. Статус и прочее (доставка, комментарии) не в счёт. */
export function diffAccountingSnapshots(before: AccountingSnapshot, after: AccountingSnapshot): AccountingChangeLine[] {
  const lines: AccountingChangeLine[] = [];
  const b = groupByProduct(before.items);
  const a = groupByProduct(after.items);

  for (const [productId, was] of b) {
    const now = a.get(productId);
    const { name, unit } = was[0];
    if (!now) {
      lines.push({ kind: 'removed', product: name, unit, before: sum(was.map((x) => x.qty)), after: null });
      continue;
    }
    const wasQty = sum(was.map((x) => x.qty));
    const nowQty = sum(now.map((x) => x.qty));
    if (wasQty !== nowQty) lines.push({ kind: 'qty', product: name, unit, before: wasQty, after: nowQty });
    const wasPrice = priceKey(was);
    const nowPrice = priceKey(now);
    if (wasPrice.join('|') !== nowPrice.join('|')) {
      lines.push({
        kind: 'price',
        product: name,
        unit,
        before: wasPrice.length === 1 ? wasPrice[0] : wasPrice.join(' / '),
        after: nowPrice.length === 1 ? nowPrice[0] : nowPrice.join(' / '),
      });
    }
  }
  for (const [productId, now] of a) {
    if (b.has(productId)) continue;
    const { name, unit } = now[0];
    const prices = priceKey(now);
    lines.push({
      kind: 'added',
      product: name,
      unit,
      before: null,
      after: `${sum(now.map((x) => x.qty))} × ${prices.join(' / ')}`,
    });
  }

  if (Math.round(before.amount * 100) !== Math.round(after.amount * 100)) {
    lines.push({ kind: 'amount', before: before.amount, after: after.amount });
  }
  if (Math.round(before.discount * 100) !== Math.round(after.discount * 100)) {
    lines.push({ kind: 'discount', before: before.discount, after: after.discount });
  }
  if (before.includeVat !== after.includeVat) lines.push({ kind: 'vat', before: before.includeVat, after: after.includeVat });
  if (before.paymentMethod !== after.paymentMethod) {
    lines.push({ kind: 'paymentMethod', before: before.paymentMethod, after: after.paymentMethod });
  }
  return lines;
}

const money = (v: unknown) => `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;

/** Короткий текст для уведомления: первые три изменения. */
export function describeChanges(lines: AccountingChangeLine[]): string {
  const parts = lines.slice(0, 3).map((l) => {
    switch (l.kind) {
      case 'price': return `цена «${l.product}» ${money(l.before)} → ${money(l.after)}`;
      case 'qty': return `кол-во «${l.product}» ${money(l.before)} → ${money(l.after)} ${l.unit ?? ''}`.trim();
      case 'added': return `добавлен «${l.product}»`;
      case 'removed': return `убран «${l.product}»`;
      case 'amount': return `сумма ${money(l.before)} → ${money(l.after)}`;
      case 'discount': return `скидка ${money(l.before)} → ${money(l.after)}`;
      case 'vat': return l.after ? 'включён НДС' : 'убран НДС';
      case 'paymentMethod': return `оплата ${l.before ?? '—'} → ${l.after ?? '—'}`;
    }
  });
  const more = lines.length > 3 ? ` и ещё ${lines.length - 3}` : '';
  return parts.join('; ') + more;
}

interface Actor {
  userId: string;
  role: string;
  permissions?: string[] | null;
}

async function notifyAccountants(dealId: string, title: string, body: string, createdByUserId: string) {
  const accountants = await prisma.user.findMany({
    where: { ...userRolesWhere(['ACCOUNTANT']), isActive: true, id: { not: createdByUserId } },
    select: { id: true },
  });
  if (accountants.length === 0) return;
  const link = `/finance/deal-changes?deal=${dealId}`;
  await prisma.notification.createMany({
    data: accountants.map((u) => ({ userId: u.id, title, body, severity: 'WARNING' as const, link, createdByUserId })),
  });
  pushService.sendPushToRoles(['ACCOUNTANT'], { title, body, url: link, severity: 'WARNING' }).catch(() => {});
  telegramService.sendToRoles(['ACCOUNTANT'], { title, body, url: link, severity: 'WARNING' }).catch(() => {});
}

/**
 * Сравнивает сделку с тем, какой она была до запроса, и заводит/дополняет запись.
 * Пока прошлая запись по сделке не проверена, правки дописываются в неё же — бухгалтер
 * видит итог «как было при проверке → как сейчас», а не десяток мелких уведомлений.
 */
export async function recordAccountingChange(dealId: string, before: AccountingSnapshot, actor: Actor): Promise<void> {
  const after = await takeAccountingSnapshot(dealId);
  if (!after) return;
  if (diffAccountingSnapshots(before, after).length === 0) return;

  const actorIsAccountant = hasRole({ role: actor.role, permissions: actor.permissions }, 'ACCOUNTANT');
  const open = await prisma.dealAccountingChange.findFirst({
    where: { dealId, reviewedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (open) {
    const base = open.before as unknown as AccountingSnapshot;
    const merged = diffAccountingSnapshots(base, after);
    await prisma.dealAccountingChange.update({
      where: { id: open.id },
      data: merged.length === 0
        // Вернули как было — проверять нечего
        ? { after: after as unknown as Prisma.InputJsonValue, changes: [], changedById: actor.userId, editCount: { increment: 1 }, lastChangedAt: new Date(), reviewedAt: new Date(), reviewNote: 'Сделку вернули к прежнему виду' }
        : { after: after as unknown as Prisma.InputJsonValue, changes: merged as unknown as Prisma.InputJsonValue, changedById: actor.userId, editCount: { increment: 1 }, lastChangedAt: new Date() },
    });
    return;
  }

  const changes = diffAccountingSnapshots(before, after);
  await prisma.dealAccountingChange.create({
    data: {
      dealId,
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      changes: changes as unknown as Prisma.InputJsonValue,
      changedById: actor.userId,
      // Бухгалтер правил сам — он в курсе, но в истории запись остаётся
      ...(actorIsAccountant ? { reviewedAt: new Date(), reviewedById: actor.userId, reviewNote: 'Изменил(а) бухгалтер' } : {}),
    },
  });
  if (actorIsAccountant) return;

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { client: { select: { companyName: true } } } });
  await notifyAccountants(
    dealId,
    'Сделка изменилась — проверьте документы',
    `«${after.title}»${deal?.client?.companyName ? ` (${deal.client.companyName})` : ''}: ${describeChanges(changes)}. Проверьте счёт-фактуру, акт сверки и договор.`,
    actor.userId,
  );
}

/** Нужно ли следить за сделкой: перечисление, и бухгалтер её уже видел. */
function isTracked(s: AccountingSnapshot): boolean {
  return s.paymentMethod === 'TRANSFER' && !NOT_YET_AT_ACCOUNTANT.includes(s.status);
}

/**
 * Middleware для роутеров, которые меняют сделку: снимок до обработчика, сравнение — после
 * успешного ответа. `getDealId` достаёт id сделки из пути (на уровне router.use params ещё нет).
 */
export function trackDealAccountingChanges(getDealId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || !req.user) return next();
    const dealId = getDealId(req);
    if (!dealId) return next();
    const actor: Actor = { userId: req.user.userId, role: req.user.role, permissions: req.user.permissions };
    takeAccountingSnapshot(dealId)
      .then((before) => {
        if (!before || !isTracked(before)) return;
        res.on('finish', () => {
          if (res.statusCode >= 400) return;
          recordAccountingChange(dealId, before, actor).catch((err) => {
            console.error('[accounting-changes] record:', err);
          });
        });
      })
      .catch((err) => console.error('[accounting-changes] snapshot:', err))
      .finally(() => next());
  };
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
/** `/:id` и `/:id/...` роутера сделок. */
export const DEAL_ID_IN_PATH = new RegExp(`^/(${UUID})(?:/|$)`);
/** `/deals/:id/override` админского роутера. */
export const ADMIN_DEAL_OVERRIDE_PATH = new RegExp(`^/deals/(${UUID})/override$`);
