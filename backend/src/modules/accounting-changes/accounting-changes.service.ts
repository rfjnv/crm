import type { NextFunction, Request, Response } from 'express';
import { DealStatus, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { hasRole, userRolesWhere } from '../../lib/roles';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';

/**
 * Изменения сделок на перечисление, которые касаются бухгалтерии.
 *
 * Бухгалтер ведёт перечисление в банк-клиенте и 1С и делает по нему документы (счёт-фактура,
 * акт сверки, договор), а потом менеджер даёт скидку, меняет ИНН или вообще способ оплаты —
 * и всё это молча расходится со сделкой. Поэтому каждый изменяющий запрос к сделке сравнивает
 * её «бухгалтерский вид» до и после; если что-то поменялось, запись попадает на страницу
 * «Изменения в сделках» и бухгалтерам приходит уведомление.
 *
 * Что считается изменением — см. relevantChanges. Смена способа оплаты с перечисления
 * важна всегда, остальное — когда сделка уже дошла до бухгалтера.
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

const VOID_STATUSES: DealStatus[] = ['CANCELED', 'REJECTED'];

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
  contractId?: string | null;
  // Поля ниже появились позже: в старых записях их нет, и сравнивать такие поля нельзя.
  contractNumber?: string | null;
  clientName?: string | null;
  transferInn?: string | null;
  transferDocuments?: string | null;
  paidAmount?: number;
  isArchived?: boolean;
  /** Сделку удалили насовсем: снимка «после» нет, это прежний снимок с отметкой. */
  deleted?: boolean;
  amount: number;
  discount: number;
  includeVat: boolean;
  items: AccountingSnapshotItem[];
}

export type AccountingChangeKind =
  | 'price' | 'qty' | 'added' | 'removed' | 'amount' | 'discount' | 'vat' | 'paymentMethod'
  | 'paid' | 'inn' | 'transferDocs' | 'contract' | 'client' | 'canceled' | 'archived' | 'deleted';

export interface AccountingChangeLine {
  kind: AccountingChangeKind;
  product?: string;
  unit?: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

/** Об этом бухгалтер узнаёт сразу, даже если прошлая запись по сделке ещё не проверена. */
const CRITICAL_KINDS: ReadonlySet<AccountingChangeKind> = new Set<AccountingChangeKind>([
  'deleted', 'canceled', 'archived', 'paymentMethod', 'inn', 'contract', 'client',
]);
const isCritical = (l: AccountingChangeLine) => CRITICAL_KINDS.has(l.kind);

/** Обычные правки по одной сделке идут пачками — одно уведомление на серию. */
const QUIET_BETWEEN_NOTICES_MS = 10 * 60 * 1000;

const num = (v: Prisma.Decimal | number | null | undefined) => Math.round(Number(v ?? 0) * 1000) / 1000;

export async function takeAccountingSnapshot(dealId: string): Promise<AccountingSnapshot | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      title: true,
      status: true,
      paymentMethod: true,
      contractId: true,
      contract: { select: { contractNumber: true } },
      client: { select: { companyName: true } },
      transferInn: true,
      transferDocuments: true,
      paidAmount: true,
      isArchived: true,
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
    contractId: deal.contractId,
    contractNumber: deal.contract?.contractNumber ?? null,
    clientName: deal.client?.companyName ?? null,
    transferInn: deal.transferInn?.trim() || null,
    transferDocuments: deal.transferDocuments ?? null,
    paidAmount: num(deal.paidAmount),
    isArchived: deal.isArchived,
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
/** Поле есть в обоих снимках и отличается; в записях старого формата его может не быть. */
const fieldChanged = <T>(x: T | undefined, y: T | undefined) => x !== undefined && y !== undefined && x !== y;

function documentsText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.join(', ') || null : raw;
  } catch {
    return raw;
  }
}

/** Что поменялось для бухгалтерии. Обычный ход статусов и прочее (доставка, комментарии) не в счёт. */
export function diffAccountingSnapshots(before: AccountingSnapshot, after: AccountingSnapshot): AccountingChangeLine[] {
  if (after.deleted) return [{ kind: 'deleted', before: before.title, after: null }];

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
  if (fieldChanged(before.transferInn, after.transferInn)) {
    lines.push({ kind: 'inn', before: before.transferInn ?? null, after: after.transferInn ?? null });
  }
  // При смене способа оплаты список документов сбрасывается сам — отдельной строкой это шум.
  if (before.paymentMethod === after.paymentMethod && fieldChanged(before.transferDocuments, after.transferDocuments)) {
    lines.push({ kind: 'transferDocs', before: documentsText(before.transferDocuments), after: documentsText(after.transferDocuments) });
  }
  if (fieldChanged(before.contractId, after.contractId)) {
    lines.push({ kind: 'contract', before: before.contractNumber ?? null, after: after.contractNumber ?? null });
  }
  if (fieldChanged(before.clientName, after.clientName)) {
    lines.push({ kind: 'client', before: before.clientName ?? null, after: after.clientName ?? null });
  }
  if (before.paidAmount !== undefined && after.paidAmount !== undefined
    && Math.round(before.paidAmount * 100) !== Math.round(after.paidAmount * 100)) {
    lines.push({ kind: 'paid', before: before.paidAmount, after: after.paidAmount });
  }
  if (!VOID_STATUSES.includes(before.status) && VOID_STATUSES.includes(after.status)) {
    lines.push({ kind: 'canceled', before: before.status, after: after.status });
  }
  if (fieldChanged(before.isArchived, after.isArchived)) {
    lines.push({ kind: 'archived', before: before.isArchived ?? null, after: after.isArchived ?? null });
  }
  return lines;
}

/**
 * Какие строки дойдут до бухгалтера:
 * - сделка уже была у бухгалтера и она на перечислении (или её только что с него сняли/на него
 *   перевели) — всё;
 * - сделка ещё не дошла, но с перечисления ушла — только сам способ оплаты и ИНН;
 * - сделка ещё не дошла и остаётся на перечислении — ничего, это обычная работа менеджера;
 * - перевод на перечисление до бухгалтера — ничего: она и так придёт на проверку финансов.
 */
export function relevantChanges(
  before: AccountingSnapshot,
  after: AccountingSnapshot,
  lines: AccountingChangeLine[],
): AccountingChangeLine[] {
  const wasTransfer = before.paymentMethod === 'TRANSFER';
  const isTransfer = after.paymentMethod === 'TRANSFER';
  if ((!wasTransfer && !isTransfer) || VOID_STATUSES.includes(before.status)) return [];
  if (!NOT_YET_AT_ACCOUNTANT.includes(before.status)) return before.paymentMethod ? lines : [];
  if (wasTransfer && !isTransfer) return lines.filter((l) => l.kind === 'paymentMethod' || l.kind === 'inn');
  return [];
}

const money = (v: unknown) => {
  // Цена может быть списком «90 / 100», если товар стоит несколькими позициями
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : String(v);
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные',
  TRANSFER: 'Перечисление',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка',
  DEBT: 'Долг',
};
const methodLabel = (v: unknown) => (v ? METHOD_LABELS[String(v)] ?? String(v) : 'не указан');

/** Короткий текст для уведомления: первые три изменения. */
export function describeChanges(lines: AccountingChangeLine[]): string {
  // Сначала важное: в уведомление попадают только первые три строки
  const ordered = [...lines.filter(isCritical), ...lines.filter((l) => !isCritical(l))];
  const parts = ordered.slice(0, 3).map((l) => {
    switch (l.kind) {
      case 'price': return `цена «${l.product}» ${money(l.before)} → ${money(l.after)}`;
      case 'qty': return `кол-во «${l.product}» ${money(l.before)} → ${money(l.after)} ${l.unit ?? ''}`.trim();
      case 'added': return `добавлен «${l.product}»`;
      case 'removed': return `убран «${l.product}»`;
      case 'amount': return `сумма ${money(l.before)} → ${money(l.after)}`;
      case 'discount': return `скидка ${money(l.before)} → ${money(l.after)}`;
      case 'vat': return l.after ? 'включён НДС' : 'убран НДС';
      case 'paymentMethod': return `оплата ${methodLabel(l.before)} → ${methodLabel(l.after)}`;
      case 'paid': return `оплачено ${money(l.before)} → ${money(l.after)}`;
      case 'inn': return `ИНН ${l.before ?? '—'} → ${l.after ?? '—'}`;
      case 'transferDocs': return `документы: ${l.after ?? 'не выбраны'}`;
      case 'contract': return `договор ${l.before ? `№${l.before}` : 'нет'} → ${l.after ? `№${l.after}` : 'нет'}`;
      case 'client': return `клиент ${l.before ?? '—'} → ${l.after ?? '—'}`;
      case 'canceled': return l.after === 'REJECTED' ? 'сделка отклонена' : 'сделка отменена';
      case 'archived': return l.after ? 'сделка в архиве' : 'сделка возвращена из архива';
      case 'deleted': return 'сделка удалена';
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

type Severity = 'WARNING' | 'URGENT';

/** Заголовок говорит о самом важном: бухгалтер может видеть только его (пуш, Telegram). */
export function buildNotice(lines: AccountingChangeLine[]): { title: string; severity: Severity } {
  const has = (kind: AccountingChangeKind) => lines.find((l) => l.kind === kind);
  if (has('deleted')) return { title: 'Сделку на перечисление удалили', severity: 'URGENT' };
  if (has('canceled')) return { title: 'Сделку на перечисление отменили', severity: 'URGENT' };
  const method = has('paymentMethod');
  if (method?.before === 'TRANSFER') return { title: `Перечисление заменили: ${methodLabel(method.after)}`, severity: 'URGENT' };
  if (method?.after === 'TRANSFER') return { title: 'Сделку перевели на перечисление', severity: 'URGENT' };
  if (has('archived')) return { title: 'Сделка на перечисление: архив', severity: 'URGENT' };
  if (has('inn')) return { title: 'Изменился ИНН перечисления', severity: 'URGENT' };
  if (has('contract')) return { title: 'Изменился договор по перечислению', severity: 'URGENT' };
  if (has('client')) return { title: 'Изменился клиент сделки на перечисление', severity: 'URGENT' };
  if (lines.length > 0 && lines.every((l) => l.kind === 'paid')) return { title: 'Деньги по сделке на перечисление', severity: 'WARNING' };
  return { title: 'Сделка изменилась — проверьте документы', severity: 'WARNING' };
}

const CHECK_HINT = 'Сверьте банк-клиент, 1С и документы.';

async function notifyAccountants(dealId: string, title: string, body: string, createdByUserId: string, severity: Severity = 'WARNING') {
  const accountants = await prisma.user.findMany({
    where: { ...userRolesWhere(['ACCOUNTANT']), isActive: true, id: { not: createdByUserId } },
    select: { id: true },
  });
  if (accountants.length === 0) return;
  const link = `/finance/deal-changes?deal=${dealId}`;
  await prisma.notification.createMany({
    data: accountants.map((u) => ({ userId: u.id, title, body, severity, link, createdByUserId })),
  });
  pushService.sendPushToRoles(['ACCOUNTANT'], { title, body, url: link, severity }).catch(() => {});
  telegramService.sendToRoles(['ACCOUNTANT'], { title, body, url: link, severity }).catch(() => {});
}

const lineKey = (l: AccountingChangeLine) => `${l.kind}|${l.product ?? ''}|${String(l.after)}`;
const dealLabel = (s: AccountingSnapshot) => `«${s.title}»${s.clientName ? ` (${s.clientName})` : ''}`;

/**
 * Сравнивает сделку с тем, какой она была до запроса, и заводит/дополняет запись.
 * Пока прошлая запись по сделке не проверена, правки дописываются в неё же — бухгалтер
 * видит итог «как было при проверке → как сейчас». Уведомление при дописывании: важное
 * (способ оплаты, ИНН, договор, отмена…) — сразу, обычные правки — не чаще раза в 10 минут.
 */
export async function recordAccountingChange(dealId: string, before: AccountingSnapshot, actor: Actor): Promise<void> {
  const after: AccountingSnapshot = (await takeAccountingSnapshot(dealId)) ?? { ...before, deleted: true };
  const direct = diffAccountingSnapshots(before, after);
  if (direct.length === 0) return;

  const actorIsAccountant = hasRole({ role: actor.role, permissions: actor.permissions }, 'ACCOUNTANT');
  const open = await prisma.dealAccountingChange.findFirst({
    where: { dealId, reviewedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (open) {
    const base = open.before as unknown as AccountingSnapshot;
    const merged = relevantChanges(base, after, diffAccountingSnapshots(base, after));
    const previous = (open.changes as unknown as AccountingChangeLine[]) ?? [];
    await prisma.dealAccountingChange.update({
      where: { id: open.id },
      data: merged.length === 0
        // Вернули как было — проверять нечего
        ? { after: after as unknown as Prisma.InputJsonValue, changes: [], changedById: actor.userId, editCount: { increment: 1 }, lastChangedAt: new Date(), reviewedAt: new Date(), reviewNote: 'Сделку вернули к прежнему виду' }
        : { after: after as unknown as Prisma.InputJsonValue, changes: merged as unknown as Prisma.InputJsonValue, changedById: actor.userId, editCount: { increment: 1 }, lastChangedAt: new Date() },
    });

    const previousKeys = new Set(previous.map(lineKey));
    const mergedKeys = new Set(merged.map(lineKey));
    const freshCritical = merged.filter((l) => isCritical(l) && !previousKeys.has(lineKey(l)));
    const undoneCritical = previous.filter((l) => isCritical(l) && !merged.some((m) => m.kind === l.kind));
    if (merged.length === 0) {
      // О важном бухгалтеру уже сообщили — значит, надо сообщить и что его отменили
      if (undoneCritical.length > 0) {
        await notifyAccountants(dealId, 'Сделку вернули к прежнему виду', `${dealLabel(after)}: отменено — ${describeChanges(undoneCritical)}. ${CHECK_HINT}`, actor.userId, 'URGENT');
      }
      return;
    }
    if (freshCritical.length > 0 || undoneCritical.length > 0) {
      const { title, severity } = buildNotice(freshCritical.length > 0 ? freshCritical : merged);
      await notifyAccountants(dealId, title, `${dealLabel(after)}: ${describeChanges(merged)}. ${CHECK_HINT}`, actor.userId, freshCritical.length > 0 ? severity : 'URGENT');
      return;
    }
    const changedSinceLast = merged.some((l) => !previousKeys.has(lineKey(l))) || previous.some((l) => !mergedKeys.has(lineKey(l)));
    const quietLongEnough = Date.now() - new Date(open.lastChangedAt).getTime() >= QUIET_BETWEEN_NOTICES_MS;
    if (changedSinceLast && quietLongEnough && !actorIsAccountant) {
      const { title, severity } = buildNotice(merged);
      await notifyAccountants(dealId, title, `${dealLabel(after)}: ${describeChanges(merged)}. ${CHECK_HINT}`, actor.userId, severity);
    }
    return;
  }

  const changes = relevantChanges(before, after, direct);
  if (changes.length === 0) return;
  // Оплату провёл сам бухгалтер — он её и видит, в списках она только мешала бы
  if (actorIsAccountant && changes.every((l) => l.kind === 'paid')) return;
  // Важное остаётся открытым, даже если правил бухгалтер: остальным бухгалтерам тоже надо знать
  const autoReviewed = actorIsAccountant && !changes.some(isCritical);
  await prisma.dealAccountingChange.create({
    data: {
      dealId,
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      changes: changes as unknown as Prisma.InputJsonValue,
      changedById: actor.userId,
      // Бухгалтер правил сам — он в курсе, но в истории запись остаётся
      ...(autoReviewed ? { reviewedAt: new Date(), reviewedById: actor.userId, reviewNote: 'Изменил(а) бухгалтер' } : {}),
    },
  });
  if (autoReviewed) return;

  const { title, severity } = buildNotice(changes);
  await notifyAccountants(dealId, title, `${dealLabel(after)}: ${describeChanges(changes)}. ${CHECK_HINT}`, actor.userId, severity);
}

/**
 * Для мест, которые двигают оплату мимо роутера сделок (Касса 2.0, зачёт, заявки на оплату):
 * вызвать после транзакции со списком «сколько прибавилось к оплаченному». Ответ не задерживает.
 */
export function recordPaidChanges(deltas: { dealId: string; delta: number }[], actor: Actor): void {
  const byDeal = new Map<string, number>();
  for (const d of deltas) byDeal.set(d.dealId, (byDeal.get(d.dealId) ?? 0) + d.delta);
  for (const [dealId, delta] of byDeal) {
    takeAccountingSnapshot(dealId)
      .then((now) => {
        if (!now || now.paymentMethod !== 'TRANSFER') return undefined;
        return recordAccountingChange(dealId, { ...now, paidAmount: num((now.paidAmount ?? 0) - delta) }, actor);
      })
      .catch((err) => console.error('[accounting-changes] paid:', err));
  }
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
        if (!before) return;
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
/** `/deals/:id/override` и `DELETE /deals/:id` админского роутера. */
export const ADMIN_DEAL_OVERRIDE_PATH = new RegExp(`^/deals/(${UUID})(?:/override)?$`);
