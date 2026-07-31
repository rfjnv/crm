import { Prisma, Role } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { pushService } from '../push/push.service';

/**
 * Общий слой оформления заказов клиента: используется и текстовым ботом, и мини-аппом,
 * чтобы правила (рабочие часы, проверка остатков, создание сделки, уведомления) были в одном месте.
 */

export const TASHKENT_TIME_ZONE = 'Asia/Tashkent';

export type HoursReasonCode = 'sunday' | 'saturday' | 'weekday';

export interface BusinessHoursStatus {
  isOpen: boolean;
  currentTimeText: string;
  reasonCode?: HoursReasonCode;
}

export function getBusinessHoursStatus(date = new Date()): BusinessHoursStatus {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TASHKENT_TIME_ZONE,
    weekday: 'short',
  }).format(date);
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: TASHKENT_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
  }).format(date));
  const minute = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: TASHKENT_TIME_ZONE,
    minute: '2-digit',
  }).format(date));
  const currentMinutes = (hour * 60) + minute;
  const currentTimeText = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TASHKENT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
  }).format(date);

  if (weekday === 'Sun') {
    return { isOpen: false, currentTimeText, reasonCode: 'sunday' };
  }

  const opensAt = weekday === 'Sat' ? 10 * 60 : 9 * 60;
  const closesAt = 18 * 60;
  if (currentMinutes < opensAt || currentMinutes >= closesAt) {
    return {
      isOpen: false,
      currentTimeText,
      reasonCode: weekday === 'Sat' ? 'saturday' : 'weekday',
    };
  }

  return { isOpen: true, currentTimeText };
}

/** Метка в notes клиента, по которой находим его же при следующем заказе из того же чата. */
export function buildClientTelegramNote(chatId: number): string {
  return `[TG_CHAT_ID:${chatId}]`;
}

export function mergeClientNotes(existingNotes: string | null, chatId: number): string {
  const tag = buildClientTelegramNote(chatId);
  if (!existingNotes) return tag;
  if (existingNotes.includes(tag)) return existingNotes;
  return `${existingNotes}\n${tag}`.trim();
}

/** Варианты записи телефона в CRM, чтобы находить клиента по номеру в любом формате. */
export function phoneSearchVariants(normalizedPhone: string | null | undefined): string[] {
  if (!normalizedPhone?.trim()) return [];
  const raw = normalizedPhone.trim();
  const digits = raw.replace(/\D/g, '');
  const set = new Set<string>();
  set.add(raw);
  if (digits) {
    set.add(digits);
    set.add(`+${digits}`);
    if (digits.startsWith('998') && digits.length === 12) {
      set.add(digits.slice(3));
    }
  }
  return [...set].filter(Boolean);
}

export function buildCustomerClientFilter(phone: string | null | undefined, chatId: number): Prisma.ClientWhereInput {
  const variants = phoneSearchVariants(phone ?? undefined);
  const tag = buildClientTelegramNote(chatId);
  const or: Prisma.ClientWhereInput[] = [{ notes: { contains: tag } }];
  if (variants.length > 0) {
    or.unshift({ phone: { in: variants } });
  }
  return { OR: or };
}

export function normalizeCustomerPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function formatOrderMoney(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} so'm`;
}

export function formatOrderQty(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let cachedSystemActorId: string | null | undefined;

/** Автор системных комментариев/уведомлений: админ, а если такого нет — сам менеджер заказа. */
export async function getSystemActorId(fallbackUserId: string): Promise<string> {
  if (cachedSystemActorId !== undefined) {
    return cachedSystemActorId || fallbackUserId;
  }

  const actor = await prisma.user.findFirst({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'] as Role[] },
    },
    select: { id: true },
    orderBy: [
      { role: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  cachedSystemActorId = actor?.id || null;
  return cachedSystemActorId || fallbackUserId;
}

/** Менеджеры, доступные клиенту для выбора (grand-astra — внутренняя компания, её не показываем). */
export const CUSTOMER_MANAGER_FILTER: Prisma.UserWhereInput = {
  role: 'MANAGER',
  isActive: true,
  OR: [{ companyId: null }, { company: { name: { not: 'grand-astra' } } }],
};

export interface OrderItemInput {
  productId: string;
  qty: number;
}

export interface OrderLine {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  price: number;
  qty: number;
  total: number;
}

export interface OrderManager {
  id: string;
  fullName: string;
  telegramChatId: string | null;
}

export interface CreateCustomerOrderInput {
  chatId: number;
  customerName: string;
  phone: string;
  managerId: string;
  items: OrderItemInput[];
  /** Комментарий клиента к заказу (мини-апп). */
  comment?: string | null;
  source: 'bot' | 'miniapp';
}

export type CreateCustomerOrderResult =
  | {
    ok: true;
    dealId: string;
    totalAmount: number;
    manager: OrderManager;
    lines: OrderLine[];
  }
  | { ok: false; reason: 'CLOSED'; hours: BusinessHoursStatus }
  | { ok: false; reason: 'EMPTY_CART' | 'MANAGER_UNAVAILABLE' | 'PRODUCT_UNAVAILABLE' }
  | { ok: false; reason: 'OUT_OF_STOCK'; product: { name: string; stock: number; unit: string } };

/**
 * Создаёт сделку по заказу клиента: клиент (найти/создать) → сделка → позиции → комментарий →
 * уведомление менеджеру в CRM и push. Возвращает разобранный результат вместо исключений,
 * чтобы вызывающая сторона показала клиенту текст на его языке.
 */
export async function createCustomerOrder(input: CreateCustomerOrderInput): Promise<CreateCustomerOrderResult> {
  const hours = getBusinessHoursStatus();
  if (!hours.isOpen) {
    return { ok: false, reason: 'CLOSED', hours };
  }

  if (!input.items.length || !input.customerName.trim() || !input.phone.trim()) {
    return { ok: false, reason: 'EMPTY_CART' };
  }

  const manager = await prisma.user.findFirst({
    where: { id: input.managerId, ...CUSTOMER_MANAGER_FILTER },
    select: { id: true, fullName: true, telegramChatId: true },
  });

  if (!manager) {
    return { ok: false, reason: 'MANAGER_UNAVAILABLE' };
  }

  const uniqueProductIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds } },
    select: {
      id: true,
      name: true,
      sku: true,
      unit: true,
      salePrice: true,
      stock: true,
      isActive: true,
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const lines: OrderLine[] = [];
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product || !product.isActive || !product.salePrice || Number(product.stock) <= 0) {
      return { ok: false, reason: 'PRODUCT_UNAVAILABLE' };
    }
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      return { ok: false, reason: 'EMPTY_CART' };
    }
    if (item.qty > Number(product.stock)) {
      return {
        ok: false,
        reason: 'OUT_OF_STOCK',
        product: { name: product.name, stock: Number(product.stock), unit: product.unit },
      };
    }

    const price = Number(product.salePrice);
    lines.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      price,
      qty: item.qty,
      total: price * item.qty,
    });
  }

  const totalAmount = lines.reduce((sum, line) => sum + line.total, 0);
  const systemActorId = await getSystemActorId(manager.id);
  const tag = buildClientTelegramNote(input.chatId);
  const customerName = input.customerName.trim();
  const phone = input.phone.trim();
  const comment = input.comment?.trim() || null;
  const sourceLabel = input.source === 'miniapp' ? 'Telegram мини-апп' : 'Telegram-бот';

  const result = await prisma.$transaction(async (tx) => {
    const existingClient = await tx.client.findFirst({
      where: {
        isArchived: false,
        OR: [
          { phone },
          { notes: { contains: tag } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const client = existingClient
      ? await tx.client.update({
        where: { id: existingClient.id },
        data: {
          companyName: customerName,
          contactName: customerName,
          phone,
          managerId: manager.id,
          notes: mergeClientNotes(existingClient.notes, input.chatId),
        },
      })
      : await tx.client.create({
        data: {
          companyName: customerName,
          contactName: customerName,
          phone,
          managerId: manager.id,
          notes: mergeClientNotes(null, input.chatId),
        },
      });

    const deal = await tx.deal.create({
      data: {
        title: `Telegram заказ от ${new Date().toLocaleDateString('ru-RU', { timeZone: TASHKENT_TIME_ZONE })}`,
        status: 'NEW',
        amount: totalAmount,
        clientId: client.id,
        managerId: manager.id,
        paymentType: 'FULL',
        paidAmount: 0,
        paymentStatus: 'UNPAID',
        terms: `Заказ создан через ${sourceLabel}. Клиент: ${customerName}. Телефон: ${phone}.`,
      },
    });

    for (const line of lines) {
      await tx.dealItem.create({
        data: {
          dealId: deal.id,
          productId: line.productId,
          requestedQty: line.qty,
          price: line.price,
          lineTotal: line.total,
          requestComment: `Заказ из ${sourceLabel}`,
          dealDate: new Date(),
        },
      });
    }

    await tx.dealComment.create({
      data: {
        dealId: deal.id,
        authorId: systemActorId,
        text: [
          `Новый заказ поступил из ${sourceLabel}.`,
          `Клиент: ${customerName}`,
          `Телефон: ${phone}`,
          `Chat ID: ${input.chatId}`,
          comment ? `Комментарий клиента: ${comment}` : '',
        ].filter(Boolean).join('\n'),
      },
    });

    await tx.notification.create({
      data: {
        userId: manager.id,
        title: `Новый заказ из ${sourceLabel}`,
        body: `${customerName} оформил заказ на ${formatOrderMoney(totalAmount)}. Нужно связаться с клиентом.`,
        severity: 'WARNING',
        link: `/deals/${deal.id}`,
        createdByUserId: systemActorId,
      },
    });

    return { dealId: deal.id };
  });

  pushService.sendPushToUser(manager.id, {
    title: `Новый заказ из ${sourceLabel}`,
    body: `${customerName} оформил заказ на ${formatOrderMoney(totalAmount)}.`,
    url: `/deals/${result.dealId}`,
    severity: 'WARNING',
  }).catch(() => {});

  return {
    ok: true,
    dealId: result.dealId,
    totalAmount,
    manager,
    lines,
  };
}

/** Сообщение менеджеру в Telegram с кнопками «связался / не дозвонился». */
export async function notifyManagerAboutOrder(
  bot: TelegramBot,
  manager: OrderManager,
  dealId: string,
  customerChatId: number,
  info: { customerName: string; phone: string; lines: OrderLine[]; comment?: string | null },
): Promise<void> {
  if (!manager.telegramChatId) return;

  const orderLines = info.lines
    .slice(0, 6)
    .map((line) => `• ${line.name}: ${formatOrderQty(line.qty)} ${line.unit} x ${formatOrderMoney(line.price)}`)
    .join('\n');

  await bot.sendMessage(
    manager.telegramChatId,
    [
      '<b>Новый заказ из Telegram</b>',
      '',
      `Клиент: <b>${escapeHtml(info.customerName || '-')}</b>`,
      `Телефон: <b>${escapeHtml(info.phone || '-')}</b>`,
      '',
      orderLines,
      info.comment ? `\nКомментарий: ${escapeHtml(info.comment)}` : '',
      '',
      'После контакта с клиентом нажмите кнопку подтверждения.',
    ].filter(Boolean).join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть сделку в CRM', url: `${config.telegram.crmUrl}/deals/${dealId}` }],
          [{ text: 'Связался с клиентом', callback_data: `managerack:${dealId}:${customerChatId}` }],
          [{ text: 'Не дозвонился', callback_data: `managerretry:${dealId}:${customerChatId}` }],
        ],
      },
    },
  ).catch(() => {});
}
