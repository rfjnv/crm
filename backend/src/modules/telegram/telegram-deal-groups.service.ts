import { DealStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { telegramService } from './telegram.service';

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

function itemsHavePositiveQty(items: { requestedQty: unknown }[]): boolean {
  return items.some((i) => {
    const q = Number(i.requestedQty);
    return Number.isFinite(q) && q > 0;
  });
}

/**
 * Склад: сделка в «Ожидает подтверждения склада» (аналог NEW → WAITING_WAREHOUSE в вашем ТЗ).
 * Один раз на сделку.
 */
export async function trySendWarehouseTelegram(dealId: string): Promise<void> {
  const chatId = config.telegram.groupWarehouseChatId;
  if (!chatId) return;

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
    },
  });

  if (!deal || deal.status !== 'WAITING_STOCK_CONFIRMATION') {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToWarehouse: false } }).catch(() => {});
    return;
  }

  const lines = deal.items.map((it) => {
    const name = esc(it.product.name);
    const sku = it.product.sku ? ` · ${esc(it.product.sku)}` : '';
    const unit = it.product.unit ? ` ${esc(it.product.unit)}` : '';
    const comment = it.requestComment?.trim()
      ? `\n   💬 ${esc(it.requestComment.trim())}`
      : '';
    return `• ${name}${sku}${unit}${comment}`;
  });

  const body = [
    '📦 <b>Склад — новая сделка на проверку</b>',
    '',
    `Клиент: <b>${esc(clientDisplayName(deal.client.companyName, deal.client.contactName))}</b>`,
    `Менеджер: <b>${esc(deal.manager.fullName)}</b>`,
    `Сделка: <b>${esc(deal.title)}</b>`,
    '',
    '<b>Товары:</b>',
    lines.length ? lines.join('\n') : '—',
  ].join('\n');

  await telegramService.sendGroupHtmlMessage(chatId, body, dealLinkPath(dealId));
}

/**
 * Производство / комплектация: сделка в IN_PROGRESS и есть количества по позициям.
 * Один раз на сделку.
 */
export async function trySendProductionTelegram(dealId: string): Promise<void> {
  const chatId = config.telegram.groupProductionChatId;
  if (!chatId) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      items: { select: { requestedQty: true } },
    },
  });
  if (!deal || deal.status !== 'IN_PROGRESS' || !itemsHavePositiveQty(deal.items)) {
    return;
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
    },
  });

  if (!full || full.status !== 'IN_PROGRESS' || !itemsHavePositiveQty(full.items)) {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToProduction: false } }).catch(() => {});
    return;
  }

  const lines = full.items
    .filter((it) => Number(it.requestedQty) > 0)
    .map((it) => {
      const qty = Number(it.requestedQty);
      const u = it.product.unit ? ` ${esc(it.product.unit)}` : '';
      return `• ${esc(it.product.name)} — <b>${esc(String(qty))}</b>${u}`;
    });

  const body = [
    '⚙️ <b>Производство — сделка в работе</b>',
    '',
    `Клиент: <b>${esc(clientDisplayName(full.client.companyName, full.client.contactName))}</b>`,
    `Менеджер: <b>${esc(full.manager.fullName)}</b>`,
    `Сделка: <b>${esc(full.title)}</b>`,
    '',
    '<b>Позиции с количествами:</b>',
    lines.length ? lines.join('\n') : '—',
  ].join('\n');

  await telegramService.sendGroupHtmlMessage(chatId, body, dealLinkPath(dealId));
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
    },
  });

  if (!deal || deal.status !== 'WAITING_FINANCE') {
    await prisma.deal.update({ where: { id: dealId }, data: { sentToFinance: false } }).catch(() => {});
    return;
  }

  const docs = parseTransferDocumentsJson(deal.transferDocuments);
  const docsBlock = docs.length ? docs.map((d) => `☑ ${esc(d)}`).join('\n') : '—';

  const body = [
    '💰 <b>Финансы — сделка на проверку</b>',
    '',
    `Клиент: <b>${esc(clientDisplayName(deal.client.companyName, deal.client.contactName))}</b>`,
    `Менеджер: <b>${esc(deal.manager.fullName)}</b>`,
    `ИНН (перечисление): <b>${esc(deal.transferInn?.trim() || deal.client.inn?.trim() || '—')}</b>`,
    `Способ оплаты: <b>${paymentMethodLabel(deal.paymentMethod)}</b>`,
    '',
    '<b>Отмеченные документы:</b>',
    docsBlock,
    '',
    `<b>Тип перечисления:</b> ${transferTypeLabel(deal.transferType)}`,
    `<b>Договор в CRM:</b> ${deal.contract ? `${esc(deal.contract.contractNumber)} (${contractTypeLabel(deal.contract.contractType)})` : 'не привязан'}`,
    '',
    `Сделка: <b>${esc(deal.title)}</b>`,
  ].join('\n');

  await telegramService.sendGroupHtmlMessage(chatId, body, dealLinkPath(dealId));
}

/** После создания сделки */
export async function onDealCreated(dealId: string, initialStatus: DealStatus, allItemsHaveQty: boolean): Promise<void> {
  if (initialStatus === 'WAITING_STOCK_CONFIRMATION') {
    await trySendWarehouseTelegram(dealId);
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
  if (newStatus === 'WAITING_STOCK_CONFIRMATION' && previousStatus === 'NEW') {
    await trySendWarehouseTelegram(dealId);
  }
  if (newStatus === 'IN_PROGRESS' && previousStatus !== 'IN_PROGRESS') {
    await trySendProductionTelegram(dealId);
  }
}
