import { DealStatus, PaymentMethod, PaymentStatus, PaymentType } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { telegramService } from './telegram.service';
import { TG_ADMIN_APPROVE_PREFIX, TG_ADMIN_REJECT_PREFIX } from './telegram-admin.constants';

const TASHKENT_TZ = 'Asia/Tashkent';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clientDisplayName(companyName: string, contactName: string | null): string {
  const c = companyName?.trim();
  const n = contactName?.trim();
  if (c && n) return `${c} (${n})`;
  return c || n || '—';
}

function dealLinkPath(dealId: string): string {
  return `/deals/${dealId}`;
}

function parseTransferDocumentsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function contractTypeLabel(t: string | null | undefined): string {
  if (t === 'ANNUAL') return 'Годовой договор';
  if (t === 'ONE_TIME') return 'Разовый договор';
  return t ? esc(t) : '—';
}

function transferTypeLabel(t: string | null | undefined): string {
  if (t === 'ANNUAL') return 'Годовой (перечисление)';
  if (t === 'ONE_TIME') return 'Разовый (перечисление)';
  return t ? esc(t) : '—';
}

function paymentMethodLabel(m: string | null | undefined): string {
  const map: Record<string, string> = {
    TRANSFER: 'Перечисление',
    INSTALLMENT: 'Рассрочка',
    CASH: 'Наличные',
    PAYME: 'Payme',
    QR: 'QR',
    CLICK: 'Click',
    TERMINAL: 'Терминал',
  };
  return m ? map[m] || esc(m) : '—';
}

function formatSum(n: unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x)} сум`;
}

function paymentTypeLabelRu(t: PaymentType | string | null | undefined): string {
  if (t === 'FULL') return 'Полная оплата';
  if (t === 'PARTIAL') return 'Частичная оплата';
  if (t === 'INSTALLMENT') return 'Рассрочка';
  return t ? esc(String(t)) : '—';
}

function formatDueDateRu(d: Date | null | undefined): string | null {
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: TASHKENT_TZ }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Краткая строка: оплачено / частично / не оплатили (долг). */
function paymentSituationLine(status: PaymentStatus, amount: number, paid: number): string {
  const debt = Math.max(0, amount - paid);
  if (amount <= 0) {
    if (status === 'PAID') return 'Ситуация по оплате: <b>отмечено как оплачено</b> (сумма сделки 0)';
    return 'Ситуация по оплате: <b>сумма сделки не задана</b>';
  }
  if (status === 'PAID' || paid >= amount) {
    return 'Ситуация по оплате: <b>Оплачено полностью</b>';
  }
  if (status === 'PARTIAL' || (paid > 0 && paid < amount)) {
    return `Ситуация по оплате: <b>Частично оплачено</b>, долг: <b>${formatSum(debt)}</b>`;
  }
  return `Ситуация по оплате: <b>Не оплатили</b> (долг: <b>${formatSum(debt)}</b>)`;
}

function truncateTelegramText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Последние комментарии к сделке (CRM), для группы. */
function buildDealCommentsBlock(
  comments: { text: string; createdAt: Date; author: { fullName: string } }[],
  maxComments = 5,
  maxLen = 400,
): string {
  const slice = comments.slice(0, maxComments);
  if (slice.length === 0) return '';
  const lines = slice.map((c) => {
    const who = esc(c.author.fullName || '—');
    const when = new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: TASHKENT_TZ,
    }).format(c.createdAt);
    const body = esc(truncateTelegramText(c.text, maxLen));
    return `• <i>${who}</i> (${esc(when)})\n${body}`;
  });
  return ['', '<b>Комментарии в CRM:</b>', ...lines].join('\n');
}

function itemsHavePositiveQty(items: { requestedQty: unknown }[]): boolean {
  return items.some((i) => {
    const q = Number(i.requestedQty);
    return Number.isFinite(q) && q > 0;
  });
}

function parseStoredTelegramMessageId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** Склад + intake: позиции, комментарии к строкам, последние комментарии к сделке в CRM. */
type DealRowWarehouseIntakeTg = {
  title: string;
  client: { companyName: string; contactName: string | null };
  manager: { fullName: string };
  items: Array<{
    requestComment: string | null;
    product: { name: string; sku: string | null; unit: string | null };
  }>;
  comments?: Array<{ text: string; createdAt: Date; author: { fullName: string } }>;
};

function buildWarehouseQueueTelegramHtml(deal: DealRowWarehouseIntakeTg): string {
  const lines = deal.items.map((it) => {
    const name = esc(it.product.name);
    const sku = it.product.sku ? ` · ${esc(it.product.sku)}` : '';
    const unit = it.product.unit ? ` ${esc(it.product.unit)}` : '';
    const comment = it.requestComment?.trim()
      ? `\n   💬 ${esc(it.requestComment.trim())}`
      : '';
    return `• ${name}${sku}${unit}${comment}`;
  });

  const commentsBlock = buildDealCommentsBlock(deal.comments ?? []);

  return [
    '📦 <b>Склад — новая сделка на проверку</b>',
    '',
    `Клиент: <b>${esc(clientDisplayName(deal.client.companyName, deal.client.contactName))}</b>`,
    `Менеджер: <b>${esc(deal.manager.fullName)}</b>`,
    `Сделка: <b>${esc(deal.title)}</b>`,
    '',
    '<b>Товары:</b>',
    lines.length ? lines.join('\n') : '—',
    ...(commentsBlock ? [commentsBlock] : []),
  ].join('\n');
}

function buildProductionIntakeTelegramHtml(deal: DealRowWarehouseIntakeTg): string {
  const lines = deal.items.map((it) => {
    const name = esc(it.product.name);
    const sku = it.product.sku ? ` · ${esc(it.product.sku)}` : '';
    const unit = it.product.unit ? ` ${esc(it.product.unit)}` : '';
    const comment = it.requestComment?.trim()
      ? `\n   💬 ${esc(it.requestComment.trim())}`
      : '';
    return `• ${name}${sku}${unit}${comment}`;
  });

  const commentsBlock = buildDealCommentsBlock(deal.comments ?? []);

  return [
    '📥 <b>Сделка принята в CRM</b> <i>(ожидает склад — не финансы)</i>',
    '',
    `Клиент: <b>${esc(clientDisplayName(deal.client.companyName, deal.client.contactName))}</b>`,
    `Менеджер: <b>${esc(deal.manager.fullName)}</b>`,
    `Сделка: <b>${esc(deal.title)}</b>`,
    '',
    '<b>Товары:</b>',
    lines.length ? lines.join('\n') : '—',
    ...(commentsBlock ? [commentsBlock] : []),
  ].join('\n');
}

function productionSyncHeader(
  status: DealStatus,
  items: { requestedQty: unknown }[],
): { header: string; paymentMethodPending: boolean } | null {
  if (status === 'IN_PROGRESS') {
    if (!itemsHavePositiveQty(items)) return null;
    return { header: '⚙️ <b>Производство — сделка в работе</b>', paymentMethodPending: true };
  }
  if (status === 'WAITING_FINANCE') {
    return { header: '📋 <b>Производство — на проверке в финансах</b>', paymentMethodPending: false };
  }
  if (status === 'ADMIN_APPROVED') {
    return { header: '📋 <b>Производство — к админу</b>', paymentMethodPending: false };
  }
  if (status === 'READY_FOR_SHIPMENT') {
    return { header: '✅ <b>Админ одобрил — можно на отгрузку товара</b>', paymentMethodPending: false };
  }
  return null;
}

/**
 * Заголовок для правки единого поста в Telegram (в т.ч. при новых комментариях в CRM).
 * Расширяет productionSyncHeader: если для статуса нет строки в основном списке, всё равно возвращаем текст,
 * иначе syncDealTelegramGroupMessages не вызывает edit — комментарии не попадают в группу.
 */
function productionSyncHeaderForEdit(
  status: DealStatus,
  items: { requestedQty: unknown }[],
): { header: string; paymentMethodPending: boolean } {
  const primary = productionSyncHeader(status, items);
  if (primary) return primary;

  const labels: Partial<Record<DealStatus, string>> = {
    FINANCE_APPROVED: '📋 <b>Производство — финансы одобрили</b>',
    STOCK_CONFIRMED: '📋 <b>Производство — склад подтвердил</b>',
    WAITING_STOCK_CONFIRMATION: '📥 <b>Производство — ожидает склад</b>',
    SHIPMENT_ON_HOLD: '⏸ <b>Отгрузка на паузе</b>',
    NEW: '📋 <b>Производство — новая заявка</b>',
    REOPENED: '📋 <b>Производство — сделка</b>',
    SHIPPED: '📋 <b>Производство — отгружено</b>',
    CLOSED: '📋 <b>Производство — закрыта</b>',
    CANCELED: '📋 <b>Производство — отменена</b>',
    REJECTED: '📋 <b>Производство — отклонена</b>',
    PENDING_APPROVAL: '📋 <b>Производство — на согласовании</b>',
  };
  const line = labels[status];
  if (line) {
    return { header: line, paymentMethodPending: status === 'WAITING_STOCK_CONFIRMATION' };
  }
  return { header: '📋 <b>Производство — сделка</b>', paymentMethodPending: false };
}

/** Данные сделки для одного сообщения в группу производства (позиции + оплата + комменты). */
type DealRowForProductionTg = {
  title: string;
  paymentMethod: PaymentMethod | null;
  paymentType: PaymentType;
  amount: unknown;
  paidAmount: unknown;
  paymentStatus: PaymentStatus;
  dueDate: Date | null;
  terms: string | null;
  client: { companyName: string; contactName: string | null };
  manager: { fullName: string };
  items: Array<{
    requestedQty: unknown;
    product: { name: string; unit: string | null };
  }>;
  comments: Array<{
    text: string;
    createdAt: Date;
    author: { fullName: string };
  }>;
  /** Для блока «отгрузка»: бухгалтерия и договор. */
  status?: DealStatus;
  sentToFinance?: boolean;
  contract?: { contractNumber: string; contractType: string } | null;
};

/** Согласовано с deals.service: перечисление / рассрочка — очередь в финансы. */
const FINANCE_REVIEW_PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = ['TRANSFER', 'INSTALLMENT'];

function paymentMethodRequiresFinanceReview(pm: PaymentMethod | null): boolean {
  return pm != null && FINANCE_REVIEW_PAYMENT_METHODS.includes(pm);
}

/** После строки «Сделка:» для READY_FOR_SHIPMENT — бух (если была очередь в финансы) + договор. */
function buildReadyForShipmentExtraLines(deal: DealRowForProductionTg): string[] {
  if (deal.status !== 'READY_FOR_SHIPMENT') return [];
  const lines: string[] = [];
  const financeApproved =
    paymentMethodRequiresFinanceReview(deal.paymentMethod) || deal.sentToFinance === true;
  if (financeApproved) {
    lines.push(`✅ <b>Бухгалтерия:</b> одобрено`);
  }
  const c = deal.contract;
  if (c?.contractNumber?.trim()) {
    const num = esc(c.contractNumber.trim());
    const typ = contractTypeLabel(c.contractType);
    lines.push(`📄 <b>Договор:</b> №${num} (${typ})`);
  }
  if (lines.length === 0) return [];
  return ['', ...lines];
}

export function buildProductionGroupHtml(
  deal: DealRowForProductionTg,
  headerLine: string,
  paymentMethodPending: boolean,
): string {
  const lines = deal.items
    .filter((it) => Number(it.requestedQty) > 0)
    .map((it) => {
      const qty = Number(it.requestedQty);
      const u = it.product.unit ? ` ${esc(it.product.unit)}` : '';
      return `• ${esc(it.product.name)} — <b>${esc(String(qty))}</b>${u}`;
    });

  const amount = Number(deal.amount);
  const paid = Number(deal.paidAmount);
  const dueLine = formatDueDateRu(deal.dueDate);
  const commentsBlock = buildDealCommentsBlock(deal.comments);
  const termsBlock = deal.terms?.trim()
    ? `\n<b>Условия / комментарий к оплате:</b>\n${esc(truncateTelegramText(deal.terms.trim(), 800))}`
    : '';

  const methodDisplay =
    paymentMethodPending && !deal.paymentMethod
      ? '— (менеджер укажет при отправке)'
      : paymentMethodLabel(deal.paymentMethod);

  const rfsExtra = buildReadyForShipmentExtraLines(deal);

  return [
    headerLine,
    '',
    `Клиент: <b>${esc(clientDisplayName(deal.client.companyName, deal.client.contactName))}</b>`,
    `Менеджер: <b>${esc(deal.manager.fullName)}</b>`,
    `Сделка: <b>${esc(deal.title)}</b>`,
    ...rfsExtra,
    '',
    '<b>Позиции с количествами:</b>',
    lines.length ? lines.join('\n') : '—',
    '',
    '<b>Оплата:</b>',
    `Способ: <b>${methodDisplay}</b>`,
    `Тип: <b>${paymentTypeLabelRu(deal.paymentType)}</b>`,
    `Сумма сделки: <b>${formatSum(deal.amount)}</b>`,
    `Внесено: <b>${formatSum(deal.paidAmount)}</b>`,
    `Остаток (долг): <b>${formatSum(Math.max(0, amount - paid))}</b>`,
    paymentSituationLine(deal.paymentStatus, amount, paid),
    ...(dueLine ? [`Срок оплаты: <b>${esc(dueLine)}</b>`] : []),
    ...(termsBlock ? [termsBlock] : []),
    ...(commentsBlock ? [commentsBlock] : []),
  ].join('\n');
}

/** В какой группе править единый пост производства (после переноса в RFS — там, пока есть message_id). */
function resolveProductionBoardChatId(deal: {
  status: DealStatus;
  productionTelegramMessageInRfsChat: boolean;
}): string | null {
  const prod = config.telegram.groupProductionChatId?.trim();
  const rfs = config.telegram.groupReadyForShipmentChatId?.trim();
  if (deal.productionTelegramMessageInRfsChat && rfs) {
    return rfs;
  }
  return prod || null;
}

/**
 * Статус READY_FOR_SHIPMENT + задан TELEGRAM_GROUP_READY_FOR_SHIPMENT_CHAT_ID:
 * дублируем пост в чат отгрузки, удаляем из производства, помечаем productionTelegramMessageInRfsChat.
 */
async function migrateProductionMessageToRfsIfNeeded(dealId: string): Promise<void> {
  const prod = config.telegram.groupProductionChatId?.trim();
  const rfs = config.telegram.groupReadyForShipmentChatId?.trim();
  if (!prod || !rfs) return;

  const row = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      status: true,
      productionTelegramMessageId: true,
      productionTelegramMessageInRfsChat: true,
    },
  });
  if (
    !row ||
    row.status !== 'READY_FOR_SHIPMENT' ||
    row.productionTelegramMessageInRfsChat ||
    !row.productionTelegramMessageId?.trim()
  ) {
    return;
  }

  const mid = parseStoredTelegramMessageId(row.productionTelegramMessageId);
  if (mid == null) return;

  const full = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true } },
      manager: { select: { fullName: true } },
      contract: { select: { contractNumber: true, contractType: true } },
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });
  if (!full) return;

  const hdr = productionSyncHeaderForEdit(full.status, full.items);

  const fullProd: DealRowForProductionTg = {
    title: full.title,
    paymentMethod: full.paymentMethod,
    paymentType: full.paymentType,
    amount: full.amount,
    paidAmount: full.paidAmount,
    paymentStatus: full.paymentStatus,
    dueDate: full.dueDate,
    terms: full.terms,
    client: full.client,
    manager: full.manager,
    items: full.items.map((it) => ({
      requestedQty: it.requestedQty,
      product: { name: it.product.name, unit: it.product.unit },
    })),
    comments: full.comments,
    status: full.status,
    sentToFinance: full.sentToFinance,
    contract: full.contract
      ? { contractNumber: full.contract.contractNumber, contractType: full.contract.contractType }
      : null,
  };
  const body = buildProductionGroupHtml(fullProd, hdr.header, hdr.paymentMethodPending);
  const path = dealLinkPath(dealId);

  const newId = await telegramService.sendGroupHtmlMessage(rfs, body, path);
  if (newId == null) {
    console.warn('[Telegram deal groups] migrate RFS: send failed dealId=', dealId);
    return;
  }

  await telegramService.deleteGroupMessage(prod, mid);
  await prisma.deal
    .update({
      where: { id: dealId },
      data: {
        productionTelegramMessageId: String(newId),
        productionTelegramMessageInRfsChat: true,
      },
    })
    .catch((err) => console.error('[Telegram deal groups] migrate RFS save:', err));
}

/**
 * Склад: сделка в «Ожидает подтверждения склада» (аналог NEW → WAITING_WAREHOUSE в вашем ТЗ).
 * Один раз на сделку.
 */
export async function trySendWarehouseTelegram(dealId: string): Promise<void> {
  const chatId = config.telegram.groupWarehouseChatId;
  if (!chatId) return;

  // Самовосстановление: флаг «отправлено» без message_id (сбой/старые данные) — снова разрешаем отправку
  const snap = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { status: true, sentToWarehouse: true, warehouseTelegramMessageId: true },
  });
  if (
    snap?.status === 'WAITING_STOCK_CONFIRMATION' &&
    snap.sentToWarehouse &&
    !snap.warehouseTelegramMessageId?.trim()
  ) {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToWarehouse: false } }).catch(() => {});
  }

  const claimed = await prisma.deal.updateMany({
    where: {
      id: dealId,
      sentToWarehouse: false,
      status: 'WAITING_STOCK_CONFIRMATION',
    },
    data: { sentToWarehouse: true },
  });
  if (claimed.count === 0) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true } },
      manager: { select: { fullName: true } },
      items: {
        include: { product: { select: { name: true, sku: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });

  if (!deal || deal.status !== 'WAITING_STOCK_CONFIRMATION') {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToWarehouse: false } }).catch(() => {});
    return;
  }

  const body = buildWarehouseQueueTelegramHtml(deal);

  const sentId = await telegramService.sendGroupHtmlMessage(chatId, body, dealLinkPath(dealId));
  if (sentId == null) {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToWarehouse: false } }).catch(() => {});
    console.warn('[Telegram deal groups] trySendWarehouseTelegram: send failed, флаг сброшен dealId=', dealId);
  } else {
    await prisma.deal
      .update({ where: { id: dealId }, data: { warehouseTelegramMessageId: String(sentId) } })
      .catch((err) => console.error('[Telegram deal groups] save warehouseTelegramMessageId:', err));
  }
}

/**
 * Производство / комплектация: сделка в IN_PROGRESS и есть количества по позициям.
 * Один пост на сделку: если уже был короткий «intake» в этой группе — превращаем его в полное сообщение, без второго поста.
 */
export async function trySendProductionTelegram(dealId: string): Promise<void> {
  const chatId = config.telegram.groupProductionChatId;
  if (!chatId) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      status: true,
      productionIntakeTelegramMessageId: true,
      productionTelegramMessageId: true,
      items: { select: { requestedQty: true } },
    },
  });
  if (!deal || deal.status !== 'IN_PROGRESS' || !itemsHavePositiveQty(deal.items)) {
    return;
  }

  const intakeMid = parseStoredTelegramMessageId(deal.productionIntakeTelegramMessageId);
  if (intakeMid != null && !deal.productionTelegramMessageId?.trim()) {
    const full = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        client: { select: { companyName: true, contactName: true } },
        manager: { select: { fullName: true } },
        items: {
          include: { product: { select: { name: true, sku: true, unit: true } } },
          orderBy: { createdAt: 'asc' },
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { author: { select: { fullName: true } } },
        },
      },
    });
    if (full && full.status === 'IN_PROGRESS' && itemsHavePositiveQty(full.items)) {
      const body = buildProductionGroupHtml(full, '⚙️ <b>Производство — сделка в работе</b>', true);
      const ok = await telegramService.editGroupHtmlMessage(chatId, intakeMid, body, dealLinkPath(dealId));
      if (ok) {
        await prisma.deal
          .update({
            where: { id: dealId },
            data: {
              productionTelegramMessageId: String(intakeMid),
              productionIntakeTelegramMessageId: null,
              sentToProduction: true,
              sentProductionIntakeTg: true,
            },
          })
          .catch((err) => console.error('[Telegram deal groups] intake→production save:', err));
        return;
      }
      await telegramService.deleteGroupMessage(chatId, intakeMid);
      await prisma.deal
        .update({
          where: { id: dealId },
          data: { productionIntakeTelegramMessageId: null, sentProductionIntakeTg: false },
        })
        .catch(() => {});
    }
  }

  const claimed = await prisma.deal.updateMany({
    where: { id: dealId, sentToProduction: false, status: 'IN_PROGRESS' },
    data: { sentToProduction: true },
  });
  if (claimed.count === 0) return;

  const full = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true } },
      manager: { select: { fullName: true } },
      items: {
        include: { product: { select: { name: true, sku: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });

  if (!full || full.status !== 'IN_PROGRESS' || !itemsHavePositiveQty(full.items)) {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToProduction: false } }).catch(() => {});
    return;
  }

  const body = buildProductionGroupHtml(full, '⚙️ <b>Производство — сделка в работе</b>', true);

  const messageId = await telegramService.sendGroupHtmlMessage(chatId, body, dealLinkPath(dealId));
  if (messageId != null) {
    await prisma.deal
      .update({
        where: { id: dealId },
        data: { productionTelegramMessageId: String(messageId), productionTelegramMessageInRfsChat: false },
      })
      .catch((err) => {
        console.error('[Telegram deal groups] save productionTelegramMessageId:', err);
      });
  } else {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToProduction: false } }).catch(() => {});
    console.warn('[Telegram deal groups] trySendProductionTelegram: send failed, флаг сброшен dealId=', dealId);
  }
}

/**
 * Производство: сразу после создания сделки в статусе «ожидает склад» — чтобы не ждать бухгалтера/финансов.
 * Отдельно от полного сообщения «в работе» (после количеств).
 */
export async function trySendProductionIntakeTelegram(dealId: string): Promise<void> {
  const chatId = config.telegram.groupProductionChatId;
  if (!chatId) return;

  const snapIn = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { status: true, sentProductionIntakeTg: true, productionIntakeTelegramMessageId: true },
  });
  if (
    snapIn?.status === 'WAITING_STOCK_CONFIRMATION' &&
    snapIn.sentProductionIntakeTg &&
    !snapIn.productionIntakeTelegramMessageId?.trim()
  ) {
    await prisma.deal.update({ where: { id: dealId }, data: { sentProductionIntakeTg: false } }).catch(() => {});
  }

  const claimed = await prisma.deal.updateMany({
    where: {
      id: dealId,
      sentProductionIntakeTg: false,
      status: 'WAITING_STOCK_CONFIRMATION',
    },
    data: { sentProductionIntakeTg: true },
  });
  if (claimed.count === 0) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true } },
      manager: { select: { fullName: true } },
      items: {
        include: { product: { select: { name: true, sku: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });

  if (!deal || deal.status !== 'WAITING_STOCK_CONFIRMATION') {
    await prisma.deal.update({ where: { id: dealId }, data: { sentProductionIntakeTg: false } }).catch(() => {});
    return;
  }

  const body = buildProductionIntakeTelegramHtml(deal);

  const sentId = await telegramService.sendGroupHtmlMessage(chatId, body, dealLinkPath(dealId));
  if (sentId == null) {
    await prisma.deal.update({ where: { id: dealId }, data: { sentProductionIntakeTg: false } }).catch(() => {});
    console.warn('[Telegram deal groups] trySendProductionIntakeTelegram: send failed, флаг сброшен dealId=', dealId);
  } else {
    await prisma.deal
      .update({ where: { id: dealId }, data: { productionIntakeTelegramMessageId: String(sentId) } })
      .catch((err) => console.error('[Telegram deal groups] save productionIntakeTelegramMessageId:', err));
  }
}

type DealForFinanceTg = {
  transferDocuments: string | null;
  amount: unknown;
  paidAmount: unknown;
  paymentStatus: PaymentStatus;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod | null;
  dueDate: Date | null;
  terms: string | null;
  title: string;
  transferType: string | null;
  transferInn: string | null;
  client: { companyName: string; contactName: string | null; inn: string | null };
  manager: { fullName: string };
  contract: { contractNumber: string; contractType: string } | null;
  comments: Array<{ text: string; createdAt: Date; author: { fullName: string } }>;
};

export function buildFinanceQueueTelegramHtml(deal: DealForFinanceTg): string {
  const docs = parseTransferDocumentsJson(deal.transferDocuments);
  const docsBlock = docs.length ? docs.map((d) => `☑ ${esc(d)}`).join('\n') : '—';

  const amount = Number(deal.amount);
  const paid = Number(deal.paidAmount);
  const dueLine = formatDueDateRu(deal.dueDate);
  const termsBlock = deal.terms?.trim()
    ? `\n<b>Условия / комментарий к оплате:</b>\n${esc(truncateTelegramText(deal.terms.trim(), 800))}`
    : '';
  const commentsBlock = buildDealCommentsBlock(deal.comments);

  return [
    '💰 <b>Финансы — сделка на проверку</b>',
    '',
    `Клиент: <b>${esc(clientDisplayName(deal.client.companyName, deal.client.contactName))}</b>`,
    `Менеджер: <b>${esc(deal.manager.fullName)}</b>`,
    `ИНН (перечисление): <b>${esc(deal.transferInn?.trim() || deal.client.inn?.trim() || '—')}</b>`,
    `Способ оплаты: <b>${paymentMethodLabel(deal.paymentMethod)}</b>`,
    '',
    '<b>Суммы и факт оплаты:</b>',
    `Тип оплаты: <b>${paymentTypeLabelRu(deal.paymentType)}</b>`,
    `Сумма сделки: <b>${formatSum(deal.amount)}</b>`,
    `Внесено: <b>${formatSum(deal.paidAmount)}</b>`,
    `Остаток (долг): <b>${formatSum(Math.max(0, amount - paid))}</b>`,
    paymentSituationLine(deal.paymentStatus, amount, paid),
    ...(dueLine ? [`Срок оплаты: <b>${esc(dueLine)}</b>`] : []),
    ...(termsBlock ? [termsBlock] : []),
    '',
    '<b>Отмеченные документы:</b>',
    docsBlock,
    '',
    `<b>Тип перечисления:</b> ${transferTypeLabel(deal.transferType)}`,
    `<b>Договор в CRM:</b> ${deal.contract ? `${esc(deal.contract.contractNumber)} (${contractTypeLabel(deal.contract.contractType)})` : 'не привязан'}`,
    '',
    `Сделка: <b>${esc(deal.title)}</b>`,
    ...(commentsBlock ? [commentsBlock] : []),
  ].join('\n');
}

function buildFinanceHtmlWithAppendix(
  deal: DealForFinanceTg & { financeTelegramAppendix: string | null },
): string {
  const base = buildFinanceQueueTelegramHtml(deal);
  const apx = deal.financeTelegramAppendix?.trim();
  if (!apx) return base;
  const lines = apx.split('\n').filter(Boolean).map((l) => `• ${esc(l)}`);
  return `${base}\n\n📌 <b>События (бухгалтерия)</b>\n${lines.join('\n')}`;
}

const MAX_FINANCE_APPENDIX_LEN = 1400;

function mergeFinanceAppendix(prev: string | null | undefined, line: string): string {
  const lines = (prev?.trim() ? prev.split('\n') : []).filter(Boolean);
  lines.push(line);
  let joined = lines.join('\n');
  while (joined.length > MAX_FINANCE_APPENDIX_LEN && lines.length > 1) {
    lines.shift();
    joined = lines.join('\n');
  }
  return joined;
}

/**
 * Добавить строку в низ сообщения группы «финансы» и пересобрать текст (актуальные суммы из БД).
 */
export async function appendFinanceTelegramLog(dealId: string, plainLine: string): Promise<void> {
  const chatId = config.telegram.groupFinanceChatId;
  if (!chatId || !plainLine.trim()) return;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.deal.findUnique({
      where: { id: dealId },
      select: { financeTelegramMessageId: true, financeTelegramAppendix: true },
    });
    if (!row?.financeTelegramMessageId) return null;
    const next = mergeFinanceAppendix(row.financeTelegramAppendix, plainLine.trim());
    await tx.deal.update({ where: { id: dealId }, data: { financeTelegramAppendix: next } });
    return { messageIdStr: row.financeTelegramMessageId };
  });

  if (!updated) return;
  const msgId = parseStoredTelegramMessageId(updated.messageIdStr);
  if (msgId == null) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true, inn: true } },
      manager: { select: { fullName: true } },
      contract: { select: { contractNumber: true, contractType: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });
  if (!deal) return;

  const html = buildFinanceHtmlWithAppendix(deal);
  const ok = await telegramService.editGroupHtmlMessage(chatId, msgId, html, dealLinkPath(dealId));
  if (!ok) {
    console.warn('[Telegram deal groups] appendFinanceTelegramLog: editMessage failed dealId=', dealId);
  }
}

/**
 * Финансы: сделка в WAITING_FINANCE (после отправки на проверку перечисления/рассрочки).
 * Один раз на сделку.
 */
export async function trySendFinanceTelegram(dealId: string): Promise<void> {
  const chatId = config.telegram.groupFinanceChatId;
  if (!chatId) return;

  const claimed = await prisma.deal.updateMany({
    where: { id: dealId, sentToFinance: false, status: 'WAITING_FINANCE' },
    data: { sentToFinance: true },
  });
  if (claimed.count === 0) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true, inn: true } },
      manager: { select: { fullName: true } },
      contract: { select: { contractNumber: true, contractType: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });

  if (!deal || deal.status !== 'WAITING_FINANCE') {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToFinance: false } }).catch(() => {});
    return;
  }

  const body = buildFinanceQueueTelegramHtml(deal);

  const messageId = await telegramService.sendGroupHtmlMessage(chatId, body, dealLinkPath(dealId));
  if (messageId != null) {
    await prisma.deal
      .update({
        where: { id: dealId },
        data: { financeTelegramMessageId: String(messageId), financeTelegramAppendix: null },
      })
      .catch((err) => {
        console.error('[Telegram deal groups] save financeTelegramMessageId:', err);
      });
  } else {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToFinance: false } }).catch(() => {});
    console.warn('[Telegram deal groups] trySendFinanceTelegram: send failed, флаг сброшен dealId=', dealId);
  }
}

/** Удалить посты «склад / intake» из чатов при уходе со статуса ожидания склада. */
export async function cleanupStockWaitTelegramMessages(
  dealId: string,
  previousStatus: DealStatus,
  newStatus: DealStatus,
): Promise<void> {
  if (previousStatus !== 'WAITING_STOCK_CONFIRMATION' || newStatus === 'WAITING_STOCK_CONFIRMATION') {
    return;
  }
  const row = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { warehouseTelegramMessageId: true, productionIntakeTelegramMessageId: true },
  });
  if (!row) return;

  const chatW = config.telegram.groupWarehouseChatId;
  const chatP = config.telegram.groupProductionChatId;
  if (chatW && row.warehouseTelegramMessageId) {
    const mid = parseStoredTelegramMessageId(row.warehouseTelegramMessageId);
    if (mid != null) await telegramService.deleteGroupMessage(chatW, mid);
  }
  if (chatP && row.productionIntakeTelegramMessageId) {
    const mid = parseStoredTelegramMessageId(row.productionIntakeTelegramMessageId);
    if (mid != null) await telegramService.deleteGroupMessage(chatP, mid);
  }

  await prisma.deal
    .update({
      where: { id: dealId },
      data: {
        warehouseTelegramMessageId: null,
        productionIntakeTelegramMessageId: null,
        sentToWarehouse: false,
        sentProductionIntakeTg: false,
      },
    })
    .catch(() => {});
}

/**
 * Пересобрать и отредактировать сообщения в группах по актуальным данным сделки
 * (склад, intake, производство, финансы).
 */
export async function syncDealTelegramGroupMessages(dealId: string): Promise<void> {
  await migrateProductionMessageToRfsIfNeeded(dealId);

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true, inn: true } },
      manager: { select: { fullName: true } },
      contract: { select: { contractNumber: true, contractType: true } },
      items: {
        include: { product: { select: { name: true, sku: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });

  if (!deal) return;

  const path = dealLinkPath(dealId);

  const chatWh = config.telegram.groupWarehouseChatId;
  if (chatWh && deal.warehouseTelegramMessageId) {
    const mid = parseStoredTelegramMessageId(deal.warehouseTelegramMessageId);
    if (mid != null) {
      const html = buildWarehouseQueueTelegramHtml(deal);
      const ok = await telegramService.editGroupHtmlMessage(chatWh, mid, html, path);
      if (!ok) {
        console.warn('[Telegram deal groups] sync: warehouse edit failed dealId=', dealId);
      }
    }
  }

  const chatPr = config.telegram.groupProductionChatId;
  if (chatPr && deal.productionIntakeTelegramMessageId) {
    const mid = parseStoredTelegramMessageId(deal.productionIntakeTelegramMessageId);
    if (mid != null) {
      const html = buildProductionIntakeTelegramHtml(deal);
      const ok = await telegramService.editGroupHtmlMessage(chatPr, mid, html, path);
      if (!ok) {
        console.warn('[Telegram deal groups] sync: production intake edit failed dealId=', dealId);
      }
    }
  }

  const chatFi = config.telegram.groupFinanceChatId;
  if (chatFi && deal.financeTelegramMessageId?.trim()) {
    const mid = parseStoredTelegramMessageId(deal.financeTelegramMessageId);
    if (mid != null) {
      const html = buildFinanceHtmlWithAppendix(deal);
      const ok = await telegramService.editGroupHtmlMessage(chatFi, mid, html, path);
      if (!ok) {
        console.warn('[Telegram deal groups] sync: finance edit failed dealId=', dealId);
      }
    }
  }

  const chatProd = resolveProductionBoardChatId(deal);
  if (chatProd && deal.productionTelegramMessageId?.trim()) {
    const mid = parseStoredTelegramMessageId(deal.productionTelegramMessageId);
    if (mid != null) {
      const hdr = productionSyncHeaderForEdit(deal.status, deal.items);
      const fullProd: DealRowForProductionTg = {
        title: deal.title,
        paymentMethod: deal.paymentMethod,
        paymentType: deal.paymentType,
        amount: deal.amount,
        paidAmount: deal.paidAmount,
        paymentStatus: deal.paymentStatus,
        dueDate: deal.dueDate,
        terms: deal.terms,
        client: deal.client,
        manager: deal.manager,
        items: deal.items.map((it) => ({
          requestedQty: it.requestedQty,
          product: { name: it.product.name, unit: it.product.unit },
        })),
        comments: deal.comments,
        status: deal.status,
        sentToFinance: deal.sentToFinance,
        contract: deal.contract
          ? { contractNumber: deal.contract.contractNumber, contractType: deal.contract.contractType }
          : null,
      };
      const body = buildProductionGroupHtml(fullProd, hdr.header, hdr.paymentMethodPending);
      const ok = await telegramService.editGroupHtmlMessage(chatProd, mid, body, path);
      if (!ok) {
        console.warn('[Telegram deal groups] sync: production edit failed dealId=', dealId);
      }
    }
  }
}

/**
 * После выбора способа оплаты / смены статуса: правим тот же пост (одно сообщение на сделку).
 * При неудаче правки — удаляем старое и шлём одно новое (без «второго» лишнего поста в типичном сценарии).
 */
export async function sendProductionPaymentSubmitTelegram(dealId: string): Promise<void> {
  await migrateProductionMessageToRfsIfNeeded(dealId);

  const prodChat = config.telegram.groupProductionChatId?.trim();
  if (!prodChat) return;

  const snap = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      status: true,
      productionTelegramMessageId: true,
      productionTelegramMessageInRfsChat: true,
    },
  });

  if (
    !snap ||
    (snap.status !== 'WAITING_FINANCE' && snap.status !== 'ADMIN_APPROVED' && snap.status !== 'READY_FOR_SHIPMENT')
  ) {
    return;
  }

  const full = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true } },
      manager: { select: { fullName: true } },
      contract: { select: { contractNumber: true, contractType: true } },
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });

  if (!full) return;

  const header =
    full.status === 'READY_FOR_SHIPMENT'
      ? '✅ <b>Админ одобрил — можно на отгрузку товара</b>'
      : full.status === 'ADMIN_APPROVED'
        ? '📋 <b>Производство — к админу</b>'
        : '📋 <b>Производство — на проверке в финансах</b>';

  const body = buildProductionGroupHtml(full, header, false);
  const path = dealLinkPath(dealId);
  const msgId = parseStoredTelegramMessageId(snap.productionTelegramMessageId);

  const chatId = resolveProductionBoardChatId({
    status: snap.status,
    productionTelegramMessageInRfsChat: snap.productionTelegramMessageInRfsChat,
  });
  if (!chatId) return;

  const rfsId = config.telegram.groupReadyForShipmentChatId?.trim();

  if (msgId != null) {
    const ok = await telegramService.editGroupHtmlMessage(chatId, msgId, body, path);
    if (ok) return;
    await telegramService.deleteGroupMessage(chatId, msgId);
  }

  const newId = await telegramService.sendGroupHtmlMessage(chatId, body, path);
  if (newId != null) {
    await prisma.deal
      .update({
        where: { id: dealId },
        data: {
          productionTelegramMessageId: String(newId),
          productionTelegramMessageInRfsChat: !!(rfsId && chatId === rfsId),
        },
      })
      .catch((err) => console.error('[Telegram deal groups] sendProductionPaymentSubmit save message id:', err));
  }
}

/**
 * Личка админам (ADMIN / SUPER_ADMIN с привязанным Telegram): сделка ADMIN_APPROVED, кнопки Подтвердить / Отклонить.
 */
export async function trySendAdminApprovalTelegram(dealId: string): Promise<void> {
  const full = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { companyName: true, contactName: true } },
      manager: { select: { fullName: true } },
      items: {
        include: { product: { select: { name: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: { select: { fullName: true } } },
      },
    },
  });

  if (!full || full.status !== 'ADMIN_APPROVED') return;

  const admins = await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      isActive: true,
      telegramChatId: { not: null },
    },
    select: { telegramChatId: true },
  });

  const chatIds = admins.map((a) => a.telegramChatId).filter((id): id is string => !!id?.trim());
  if (chatIds.length === 0) {
    console.warn('[Telegram] trySendAdminApprovalTelegram: нет ADMIN/SUPER_ADMIN с привязанным Telegram');
    return;
  }

  const body = buildProductionGroupHtml(full, '✅ <b>Админ — подтвердите сделку</b>', false);

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Подтвердить', callback_data: `${TG_ADMIN_APPROVE_PREFIX}${dealId}` },
        { text: '❌ Отклонить', callback_data: `${TG_ADMIN_REJECT_PREFIX}${dealId}` },
      ],
    ],
  };

  const path = dealLinkPath(dealId);
  await Promise.allSettled(
    chatIds.map((chatId) =>
      telegramService.sendHtmlMessageWithKeyboard(chatId.trim(), body, keyboard, path),
    ),
  );
}

/** После создания сделки */
export async function onDealCreated(dealId: string, initialStatus: DealStatus, allItemsHaveQty: boolean): Promise<void> {
  if (initialStatus === 'WAITING_STOCK_CONFIRMATION') {
    await trySendWarehouseTelegram(dealId);
    await trySendProductionIntakeTelegram(dealId);
  }
  if (initialStatus === 'IN_PROGRESS' && allItemsHaveQty) {
    await trySendProductionTelegram(dealId);
  }
}

/** После PATCH смены статуса */
export async function onDealStatusChanged(
  dealId: string,
  previousStatus: DealStatus,
  newStatus: DealStatus,
): Promise<void> {
  await cleanupStockWaitTelegramMessages(dealId, previousStatus, newStatus);

  // Любой вход в «ожидает склад», не только из NEW (напр. IN_PROGRESS / STOCK_CONFIRMED → склад)
  if (newStatus === 'WAITING_STOCK_CONFIRMATION' && previousStatus !== 'WAITING_STOCK_CONFIRMATION') {
    await trySendWarehouseTelegram(dealId);
    await trySendProductionIntakeTelegram(dealId);
  }
  if (newStatus === 'IN_PROGRESS' && previousStatus !== 'IN_PROGRESS') {
    await trySendProductionTelegram(dealId);
  }
}
