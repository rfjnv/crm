import { DealStatus, Prisma } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { getFirstName } from '../../lib/name-utils';
import { pushService } from '../push/push.service';
import { Lang, LANG_LABELS, t, customerStatusLabel } from './telegram.customer-i18n';
import {
  BusinessHoursStatus,
  TASHKENT_TIME_ZONE,
  buildClientTelegramNote,
  buildCustomerClientFilter,
  createCustomerOrder,
  getBusinessHoursStatus,
  getSystemActorId,
  mergeClientNotes,
  normalizeCustomerPhone,
  notifyManagerAboutOrder,
} from './telegram-order.service';

const PAGE_SIZE = 6;
/** Сделки, по которым клиенту разрешён отзыв (должны совпадать с реальным процессом у вас в CRM) */
const REVIEWABLE_DEAL_STATUSES: DealStatus[] = ['CLOSED', 'SHIPPED', 'REOPENED'];

type SessionMode =
  | 'IDLE'
  | 'AWAITING_QTY'
  | 'AWAITING_NAME'
  | 'AWAITING_PHONE'
  | 'AWAITING_REVIEW_PHONE'
  | 'AWAITING_ORDERS_PHONE'
  | 'AWAITING_REVIEW_TEXT';

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  price: number;
  qty: number;
}

interface PendingQuantityInput {
  productId: string;
  page: number;
}

interface ReviewDraft {
  dealId: string;
  rating: number;
}

interface CustomerSession {
  mode: SessionMode;
  cart: CartItem[];
  language?: Lang;
  selectedManagerId?: string;
  customerName?: string;
  phone?: string;
  pendingQty?: PendingQuantityInput;
  reviewDraft?: ReviewDraft;
  reviewAllowedDealIds?: string[];
  submittingOrder?: boolean;
  categories?: string[];
  currentCategory?: string | null;
}

export class TelegramCustomerService {
  private sessions = new Map<number, CustomerSession>();

  async handleStart(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const firstName = msg.from?.first_name;
    const session = this.getSession(chatId);

    const pref = await prisma.telegramCustomerPreference.findUnique({ where: { chatId: String(chatId) } });
    if (!pref) {
      session.language = 'ru';
      await this.showLanguagePicker(bot, chatId);
      return;
    }

    session.language = pref.language === 'uz' ? 'uz' : 'ru';
    await this.sendWelcome(bot, chatId, session.language, firstName);
  }

  async handleMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    if (!msg.chat || msg.from?.is_bot) return;

    const chatId = msg.chat.id;
    const session = this.getSession(chatId);
    const lang = await this.getLang(chatId, session);

    if (msg.text?.startsWith('/')) {
      await this.handleCommand(bot, msg, session, lang);
      return;
    }

    if (msg.contact) {
      const normalized = this.normalizePhone(msg.contact.phone_number);
      if (!normalized) {
        await bot.sendMessage(chatId, t(lang, 'checkout.phoneInvalidContact'));
        return;
      }

      session.phone = normalized;
      await bot.sendMessage(chatId, t(lang, 'checkout.phoneSaved', { phone: this.escapeHtml(normalized) }), {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true },
      });

      if (session.mode === 'AWAITING_PHONE') {
        session.mode = 'IDLE';
        await this.trySubmitOrder(bot, chatId, session, lang);
        return;
      }

      if (session.mode === 'AWAITING_REVIEW_PHONE') {
        session.mode = 'IDLE';
        await this.showReviewDealPicker(bot, chatId, lang, normalized);
        return;
      }

      if (session.mode === 'AWAITING_ORDERS_PHONE') {
        session.mode = 'IDLE';
        await this.showOrderList(bot, chatId, session, lang);
      }

      return;
    }

    const text = msg.text?.trim();
    if (!text) return;

    const lowerText = text.toLowerCase();
    if (lowerText === 'отмена' || lowerText === 'bekor qilish') {
      session.mode = 'IDLE';
      session.pendingQty = undefined;
      session.reviewDraft = undefined;
      session.reviewAllowedDealIds = undefined;
      await bot.sendMessage(chatId, t(lang, 'common.cancelled'), {
        reply_markup: { remove_keyboard: true },
      });
      await this.showHome(bot, chatId, lang);
      return;
    }

    if (session.mode === 'AWAITING_QTY' && session.pendingQty) {
      await this.handleQuantityInput(bot, chatId, session, lang, text);
      return;
    }

    if (session.mode === 'AWAITING_NAME') {
      session.customerName = text;
      session.mode = 'AWAITING_PHONE';
      await this.askPhone(bot, chatId, lang, t(lang, 'checkout.askPhone'));
      return;
    }

    if (session.mode === 'AWAITING_PHONE') {
      const normalized = this.normalizePhone(text);
      if (!normalized) {
        await bot.sendMessage(chatId, t(lang, 'checkout.phoneInvalid'));
        return;
      }

      session.phone = normalized;
      session.mode = 'IDLE';
      await bot.sendMessage(chatId, t(lang, 'checkout.phoneSaved', { phone: this.escapeHtml(normalized) }), {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true },
      });
      await this.trySubmitOrder(bot, chatId, session, lang);
      return;
    }

    if (session.mode === 'AWAITING_REVIEW_PHONE') {
      const normalized = this.normalizePhone(text);
      if (!normalized) {
        await bot.sendMessage(chatId, t(lang, 'review.phoneInvalid'));
        return;
      }

      session.phone = normalized;
      session.mode = 'IDLE';
      await bot.sendMessage(chatId, t(lang, 'orders.searching', { phone: this.escapeHtml(normalized) }), {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true },
      });
      await this.showReviewDealPicker(bot, chatId, lang, normalized);
      return;
    }

    if (session.mode === 'AWAITING_ORDERS_PHONE') {
      const normalized = this.normalizePhone(text);
      if (!normalized) {
        await bot.sendMessage(chatId, t(lang, 'review.phoneInvalid'));
        return;
      }

      session.phone = normalized;
      session.mode = 'IDLE';
      await bot.sendMessage(chatId, t(lang, 'orders.searching', { phone: this.escapeHtml(normalized) }), {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true },
      });
      await this.showOrderList(bot, chatId, session, lang);
      return;
    }

    if (session.mode === 'AWAITING_REVIEW_TEXT' && session.reviewDraft) {
      const reviewText = text === '-' ? '' : text;
      await this.saveReview(bot, chatId, session, lang, reviewText);
      return;
    }

    await bot.sendMessage(chatId, t(lang, 'common.fallback'), {
      reply_markup: this.buildHomeKeyboard(lang),
    });
  }

  async handleCallbackQuery(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.message?.chat || !query.data) return;

    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const session = this.getSession(chatId);
    const lang = await this.getLang(chatId, session);

    try {
      if (query.data.startsWith('lang:') && query.data !== 'lang:switch') {
        const chosen: Lang = query.data.split(':')[1] === 'uz' ? 'uz' : 'ru';
        await prisma.telegramCustomerPreference.upsert({
          where: { chatId: String(chatId) },
          create: { chatId: String(chatId), language: chosen },
          update: { language: chosen },
        });
        session.language = chosen;
        await bot.answerCallbackQuery(query.id, { text: t(chosen, 'lang.saved', { lang: LANG_LABELS[chosen] }) }).catch(() => {});
        await this.showHome(bot, chatId, chosen, messageId);
        return;
      }

      if (query.data === 'lang:switch') {
        await this.showLanguagePicker(bot, chatId, messageId);
        return;
      }

      if (query.data === 'menu:home') {
        session.mode = 'IDLE';
        session.pendingQty = undefined;
        session.reviewDraft = undefined;
        session.reviewAllowedDealIds = undefined;
        session.currentCategory = null;
        await this.showHome(bot, chatId, lang, messageId);
        return;
      }

      if (query.data === 'menu:hours') {
        await this.showBusinessHours(bot, chatId, lang, messageId);
        return;
      }

      if (query.data === 'menu:order') {
        await this.showManagerPicker(bot, chatId, lang, 0, messageId);
        return;
      }

      if (query.data === 'menu:orders') {
        await this.showOrderList(bot, chatId, session, lang, messageId);
        return;
      }

      if (query.data === 'menu:review') {
        session.reviewDraft = undefined;
        session.reviewAllowedDealIds = undefined;
        if (session.phone) {
          await this.showReviewDealPicker(bot, chatId, lang, session.phone, messageId);
        } else {
          session.mode = 'AWAITING_REVIEW_PHONE';
          await bot.sendMessage(chatId, t(lang, 'review.askPhone'), {
            reply_markup: this.buildPhoneKeyboard(lang),
          });
        }
        return;
      }

      if (query.data.startsWith('manager:page:')) {
        const page = this.parsePositiveInt(query.data.split(':')[2] || '0', 0);
        await this.showManagerPicker(bot, chatId, lang, page, messageId);
        return;
      }

      if (query.data.startsWith('manager:pick:')) {
        const managerId = query.data.split(':')[2];
        session.selectedManagerId = managerId;
        if (session.cart.length === 0) {
          await this.showCatalog(bot, chatId, lang, 0, messageId, t(lang, 'manager.selected'));
        } else {
          await this.showCart(bot, chatId, lang, messageId, t(lang, 'manager.updated'));
        }
        return;
      }

      if (query.data === 'catalog:cats') {
        session.currentCategory = null;
        await this.showCatalog(bot, chatId, lang, 0, messageId);
        return;
      }

      if (query.data.startsWith('catalog:cat:')) {
        const catIndex = this.parsePositiveInt(query.data.split(':')[2] || '0', -1);
        if (session.categories && catIndex >= 0 && catIndex < session.categories.length) {
          session.currentCategory = session.categories[catIndex];
          await this.showCatalog(bot, chatId, lang, 0, messageId);
        } else {
          await this.showCatalog(bot, chatId, lang, 0, messageId);
        }
        return;
      }

      if (query.data.startsWith('catalog:page:')) {
        const page = this.parsePositiveInt(query.data.split(':')[2] || '0', 0);
        await this.showCatalog(bot, chatId, lang, page, messageId);
        return;
      }

      if (query.data.startsWith('catalog:photo:')) {
        const [, , productId, pageToken] = query.data.split(':');
        const page = this.parsePositiveInt(pageToken || '0', 0);
        await this.showProductDetail(bot, chatId, lang, productId, page, messageId);
        return;
      }

      if (query.data.startsWith('catalog:pick:')) {
        const [, , productId, pageToken] = query.data.split(':');
        const page = this.parsePositiveInt(pageToken || '0', 0);
        await this.askQuantity(bot, chatId, session, lang, productId, page, messageId);
        return;
      }

      if (query.data === 'cart:view') {
        await this.showCart(bot, chatId, lang, messageId);
        return;
      }

      if (query.data === 'cart:clear') {
        session.cart = [];
        await this.showCatalog(bot, chatId, lang, 0, messageId, t(lang, 'cart.cleared'));
        return;
      }

      if (query.data.startsWith('cart:remove:')) {
        const productId = query.data.split(':')[2];
        session.cart = session.cart.filter((item) => item.productId !== productId);
        await this.showCart(bot, chatId, lang, messageId, t(lang, 'cart.itemRemoved'));
        return;
      }

      if (query.data === 'cart:checkout') {
        if (session.submittingOrder) {
          await bot.answerCallbackQuery(query.id, { text: t(lang, 'checkout.inProgress') }).catch(() => {});
          return;
        }
        await this.startCheckout(bot, chatId, session, lang);
        return;
      }

      if (query.data === 'cart:addmore') {
        await this.showCatalog(bot, chatId, lang, 0, messageId);
        return;
      }

      if (query.data.startsWith('review:deal:')) {
        const dealId = query.data.split(':')[2];
        await this.showReviewRatingPicker(bot, chatId, session, lang, dealId, messageId);
        return;
      }

      if (query.data.startsWith('review:rate:')) {
        const rating = this.parsePositiveInt(query.data.split(':')[2] || '0', 0);
        if (rating < 1 || rating > 5) {
          await bot.answerCallbackQuery(query.id, { text: '1-5' });
          return;
        }

        if (!session.reviewDraft?.dealId) {
          await bot.answerCallbackQuery(query.id, { text: t(lang, 'review.notAllowed') }).catch(() => {});
          if (session.phone) {
            await this.showReviewDealPicker(bot, chatId, lang, session.phone, messageId);
          } else {
            await this.showHome(bot, chatId, lang, messageId);
          }
          return;
        }

        session.reviewDraft = {
          dealId: session.reviewDraft.dealId,
          rating,
        };
        session.mode = 'AWAITING_REVIEW_TEXT';

        await this.editOrSendMessage(
          bot,
          chatId,
          [
            `<b>${rating}/5</b>`,
            '',
            t(lang, 'review.askText'),
          ].join('\n'),
          {
            messageId,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: t(lang, 'common.cancelButton'), callback_data: 'menu:home' }]],
            },
          },
        );
        return;
      }

      if (query.data.startsWith('managerack:')) {
        await this.handleManagerContactConfirmation(bot, query, true);
        return;
      }

      if (query.data.startsWith('managerretry:')) {
        await this.handleManagerContactConfirmation(bot, query, false);
        return;
      }
    } finally {
      await bot.answerCallbackQuery(query.id).catch(() => {});
    }
  }

  private async handleCommand(bot: TelegramBot, msg: TelegramBot.Message, session: CustomerSession, lang: Lang): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    if (text === '/menu') {
      session.mode = 'IDLE';
      session.pendingQty = undefined;
      session.reviewDraft = undefined;
      session.reviewAllowedDealIds = undefined;
      session.currentCategory = null;
      await this.showHome(bot, chatId, lang);
      return;
    }

    if (text === '/hours') {
      await this.showBusinessHours(bot, chatId, lang);
      return;
    }

    if (text === '/order') {
      await this.showManagerPicker(bot, chatId, lang, 0);
      return;
    }

    if (text === '/orders') {
      await this.showOrderList(bot, chatId, session, lang);
      return;
    }

    if (text === '/cart') {
      await this.showCart(bot, chatId, lang);
      return;
    }

    if (text === '/review') {
      if (session.phone) {
        await this.showReviewDealPicker(bot, chatId, lang, session.phone);
      } else {
        session.mode = 'AWAITING_REVIEW_PHONE';
        await bot.sendMessage(chatId, t(lang, 'review.askPhone'), {
          reply_markup: this.buildPhoneKeyboard(lang),
        });
      }
    }
  }

  /** Мини-аппа сменила язык — обновляем кэш сессии, иначе бот продолжит отвечать на старом. */
  syncSessionLanguage(chatId: number, lang: Lang): void {
    this.getSession(chatId).language = lang;
  }

  private getSession(chatId: number): CustomerSession {
    const existing = this.sessions.get(chatId);
    if (existing) return existing;

    const created: CustomerSession = {
      mode: 'IDLE',
      cart: [],
    };
    this.sessions.set(chatId, created);
    return created;
  }

  private async getLang(chatId: number, session: CustomerSession): Promise<Lang> {
    if (session.language) return session.language;
    const pref = await prisma.telegramCustomerPreference.findUnique({ where: { chatId: String(chatId) } });
    session.language = pref?.language === 'uz' ? 'uz' : 'ru';
    return session.language;
  }

  private async showLanguagePicker(bot: TelegramBot, chatId: number, messageId?: number): Promise<void> {
    await this.editOrSendMessage(
      bot,
      chatId,
      'Выберите язык общения с ботом / Bot bilan muloqot tilini tanlang:',
      {
        messageId,
        reply_markup: {
          inline_keyboard: [[
            { text: LANG_LABELS.ru, callback_data: 'lang:ru' },
            { text: LANG_LABELS.uz, callback_data: 'lang:uz' },
          ]],
        },
      },
    );
  }

  private async sendWelcome(bot: TelegramBot, chatId: number, lang: Lang, firstName?: string): Promise<void> {
    await bot.sendMessage(
      chatId,
      [
        `<b>${t(lang, 'start.title')}</b>`,
        '',
        firstName
          ? t(lang, 'start.greeting.named', { name: this.escapeHtml(firstName) })
          : t(lang, 'start.greeting.anon'),
        '',
        t(lang, 'start.hoursHeader'),
        t(lang, 'start.hours.monFri'),
        t(lang, 'start.hours.sat'),
        t(lang, 'start.hours.sun'),
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: this.buildHomeKeyboard(lang),
      },
    );
  }

  private async showHome(bot: TelegramBot, chatId: number, lang: Lang, messageId?: number): Promise<void> {
    const hours = this.getBusinessHoursStatus();
    const summary = hours.isOpen
      ? t(lang, 'hours.open')
      : t(lang, 'hours.closed', { reason: hours.reasonCode ? t(lang, `hours.reason.${hours.reasonCode}`) : '' });

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        summary,
        t(lang, 'hours.currentTime', { time: hours.currentTimeText }),
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: this.buildHomeKeyboard(lang),
      },
    );
  }

  private async showBusinessHours(bot: TelegramBot, chatId: number, lang: Lang, messageId?: number): Promise<void> {
    const hours = this.getBusinessHoursStatus();
    const statusLine = hours.isOpen
      ? t(lang, 'hours.open')
      : t(lang, 'hours.closed', { reason: hours.reasonCode ? t(lang, `hours.reason.${hours.reasonCode}`) : '' });

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        `<b>${t(lang, 'hours.title')}</b>`,
        '',
        statusLine,
        t(lang, 'hours.currentTime', { time: hours.currentTimeText }),
        '',
        t(lang, 'start.hours.monFri'),
        t(lang, 'start.hours.sat'),
        t(lang, 'start.hours.sun'),
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]],
        },
      },
    );
  }

  private async showManagerPicker(
    bot: TelegramBot,
    chatId: number,
    lang: Lang,
    page = 0,
    messageId?: number,
  ): Promise<void> {
    const managers = await prisma.user.findMany({
      where: {
        role: 'MANAGER',
        isActive: true,
        OR: [{ companyId: null }, { company: { name: { not: 'grand-astra' } } }],
      },
      select: { id: true, fullName: true, telegramChatId: true },
      orderBy: { fullName: 'asc' },
    });

    if (!managers.length) {
      await this.editOrSendMessage(
        bot,
        chatId,
        t(lang, 'manager.empty'),
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]],
          },
        },
      );
      return;
    }

    const totalPages = Math.ceil(managers.length / PAGE_SIZE);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * PAGE_SIZE;
    const pageManagers = managers.slice(start, start + PAGE_SIZE);

    const keyboard: TelegramBot.InlineKeyboardButton[][] = pageManagers.map((manager) => [
      {
        text: `👤 ${this.truncate(getFirstName(manager.fullName), 28)}`,
        callback_data: `manager:pick:${manager.id}`,
      },
    ]);

    if (totalPages > 1) {
      keyboard.push(this.buildPaginationRow('manager', safePage, totalPages));
    }

    keyboard.push([{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        `<b>${t(lang, 'manager.title')}</b>`,
        '',
        t(lang, 'manager.subtitle'),
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      },
    );
  }

  private async showCatalog(
    bot: TelegramBot,
    chatId: number,
    lang: Lang,
    page = 0,
    messageId?: number,
    notice?: string,
  ): Promise<void> {
    const session = this.getSession(chatId);

    const selectedManager = session.selectedManagerId
      ? await prisma.user.findUnique({
        where: { id: session.selectedManagerId },
        select: { fullName: true },
      })
      : null;

    if (!session.currentCategory) {
      const dbCategories = await prisma.product.findMany({
        where: { isActive: true, stock: { gt: 0 }, salePrice: { not: null } },
        select: { category: true },
        distinct: ['category'],
      });

      const uncategorizedLabel = t(lang, 'catalog.uncategorized');
      const categories = dbCategories.map((p) => p.category || uncategorizedLabel).sort();
      session.categories = categories;

      if (!categories.length) {
        await this.editOrSendMessage(
          bot,
          chatId,
          t(lang, 'catalog.empty'),
          {
            messageId,
            reply_markup: {
              inline_keyboard: [[{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]],
            },
          },
        );
        return;
      }

      const totalPages = Math.ceil(categories.length / PAGE_SIZE);
      const safePage = Math.max(0, Math.min(page, totalPages - 1));
      const start = safePage * PAGE_SIZE;
      const pageCategories = categories.slice(start, start + PAGE_SIZE);

      const keyboard: TelegramBot.InlineKeyboardButton[][] = pageCategories.map((cat) => {
        const index = session.categories!.indexOf(cat);
        return [
          {
            text: `📁 ${this.truncate(cat, 35)}`,
            callback_data: `catalog:cat:${index}`,
          },
        ];
      });

      if (totalPages > 1) {
        keyboard.push(this.buildPaginationRow('catalog', safePage, totalPages));
      }

      keyboard.push([
        { text: t(lang, 'menu.cart', { count: session.cart.length }), callback_data: 'cart:view' },
        { text: t(lang, 'menu.manager'), callback_data: 'manager:page:0' },
      ]);
      keyboard.push([{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]);

      await this.editOrSendMessage(
        bot,
        chatId,
        [
          notice ? `<i>${this.escapeHtml(notice)}</i>` : '',
          `✨ <b>${t(lang, 'catalog.categoriesTitle')}</b>`,
          selectedManager ? t(lang, 'manager.label', { name: this.escapeHtml(getFirstName(selectedManager.fullName)) }) : t(lang, 'manager.notSelected'),
        ].filter(Boolean).join('\n'),
        {
          messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        },
      );
      return;
    }

    const uncategorizedLabel = t(lang, 'catalog.uncategorized');
    const isNoCategory = session.currentCategory === uncategorizedLabel;
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        stock: { gt: 0 },
        salePrice: { not: null },
        category: isNoCategory ? null : session.currentCategory,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        salePrice: true,
        stock: true,
        imageUrl: true,
        badge: true,
        badgeUntil: true,
      },
      orderBy: { name: 'asc' },
    });

    if (!products.length) {
      session.currentCategory = null;
      await this.showCatalog(bot, chatId, lang, 0, messageId, t(lang, 'catalog.categoryEmptied'));
      return;
    }

    const totalPages = Math.ceil(products.length / PAGE_SIZE);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * PAGE_SIZE;
    const pageProducts = products.slice(start, start + PAGE_SIZE);

    const productLines = pageProducts.map((p, index) => {
      const badge = this.activeBadge(p.badge, p.badgeUntil);
      const badgeLabel = badge ? ` | ${t(lang, `badge.${badge}`)}` : '';
      return `${index + 1}. <b>${this.escapeHtml(p.name)}</b>\n      ${t(lang, 'catalog.detail.price', { price: this.formatMoney(Number(p.salePrice || 0)) })} | ${t(lang, 'catalog.inStock')}${badgeLabel}`;
    });

    const productButtons: TelegramBot.InlineKeyboardButton[][] = pageProducts.map((p, index) => {
      const row: TelegramBot.InlineKeyboardButton[] = [
        { text: `➕ ${index + 1}`, callback_data: `catalog:pick:${p.id}:${safePage}` },
      ];
      if (p.imageUrl) {
        row.push({ text: t(lang, 'catalog.photoButton'), callback_data: `catalog:photo:${p.id}:${safePage}` });
      }
      return row;
    });

    const keyboard: TelegramBot.InlineKeyboardButton[][] = [...productButtons];

    if (totalPages > 1) {
      keyboard.push(this.buildPaginationRow('catalog', safePage, totalPages));
    }

    keyboard.push([{ text: t(lang, 'catalog.backToCategories'), callback_data: 'catalog:cats' }]);

    keyboard.push([
      { text: t(lang, 'menu.cart', { count: session.cart.length }), callback_data: 'cart:view' },
      { text: t(lang, 'menu.manager'), callback_data: 'manager:page:0' },
    ]);
    keyboard.push([{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        notice ? `<i>${this.escapeHtml(notice)}</i>` : '',
        `📁 <b>${this.escapeHtml(session.currentCategory)}</b>`,
        selectedManager ? t(lang, 'manager.label', { name: this.escapeHtml(getFirstName(selectedManager.fullName)) }) : t(lang, 'manager.notSelected'),
        '',
        ...productLines,
        '',
        t(lang, 'catalog.chooseButtonHint'),
      ].filter(Boolean).join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      },
    );
  }

  private async showProductDetail(
    bot: TelegramBot,
    chatId: number,
    lang: Lang,
    productId: string,
    page: number,
    messageId?: number,
  ): Promise<void> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        stock: true,
        salePrice: true,
        isActive: true,
        imageUrl: true,
        description: true,
        postTextRu: true,
        postTextUz: true,
      },
    });

    if (!product || !product.isActive || !product.salePrice || Number(product.stock) <= 0) {
      await this.editOrSendMessage(
        bot,
        chatId,
        t(lang, 'catalog.detail.notFound'),
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, 'catalog.detail.back'), callback_data: `catalog:page:${page}` }]],
          },
        },
      );
      return;
    }

    const descriptionText = (lang === 'uz' && product.postTextUz)
      ? product.postTextUz
      : (product.description || (lang === 'ru' ? product.postTextRu : null));

    const caption = [
      `<b>${this.escapeHtml(product.name)}</b>`,
      t(lang, 'catalog.detail.price', { price: this.formatMoney(Number(product.salePrice)) }),
      t(lang, 'catalog.detail.stock', { stock: this.formatQty(Number(product.stock)), unit: this.escapeHtml(product.unit || '') }),
      '',
      this.escapeHtml(descriptionText || t(lang, 'catalog.detail.noDescription')),
    ].join('\n');

    const keyboard: TelegramBot.InlineKeyboardMarkup = {
      inline_keyboard: [
        [{ text: t(lang, 'catalog.detail.addToCart'), callback_data: `catalog:pick:${product.id}:${page}` }],
        [{ text: t(lang, 'catalog.detail.back'), callback_data: `catalog:page:${page}` }],
      ],
    };

    const absoluteImageUrl = product.imageUrl
      ? (product.imageUrl.startsWith('http') ? product.imageUrl : `${config.telegram.crmUrl}${product.imageUrl}`)
      : null;

    if (absoluteImageUrl) {
      try {
        await bot.sendPhoto(chatId, absoluteImageUrl, {
          caption,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        return;
      } catch (err) {
        console.error('[Telegram customer bot] sendPhoto failed:', err);
      }
    }

    await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: keyboard });
  }

  private async askQuantity(
    bot: TelegramBot,
    chatId: number,
    session: CustomerSession,
    lang: Lang,
    productId: string,
    page: number,
    messageId?: number,
  ): Promise<void> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        stock: true,
        salePrice: true,
        isActive: true,
      },
    });

    if (!product || !product.isActive || !product.salePrice || Number(product.stock) <= 0) {
      await this.editOrSendMessage(
        bot,
        chatId,
        t(lang, 'qty.productUnavailable'),
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, 'catalog.detail.back'), callback_data: `catalog:page:${page}` }]],
          },
        },
      );
      return;
    }

    session.mode = 'AWAITING_QTY';
    session.pendingQty = { productId, page };

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        `<b>${this.escapeHtml(product.name)}</b>`,
        `<code>${this.escapeHtml(product.sku)}</code>`,
        t(lang, 'catalog.detail.price', { price: this.formatMoney(Number(product.salePrice)) }),
        '',
        t(lang, 'qty.ask', { unit: this.escapeHtml(product.unit || ''), name: this.escapeHtml(product.name), stock: this.formatQty(Number(product.stock)) }),
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: t(lang, 'catalog.detail.back'), callback_data: `catalog:page:${page}` }],
            [{ text: t(lang, 'menu.cart', { count: session.cart.length }), callback_data: 'cart:view' }],
          ],
        },
      },
    );
  }

  private async handleQuantityInput(
    bot: TelegramBot,
    chatId: number,
    session: CustomerSession,
    lang: Lang,
    rawInput: string,
  ): Promise<void> {
    const pending = session.pendingQty;
    if (!pending) {
      session.mode = 'IDLE';
      return;
    }

    const qty = this.parseQty(rawInput);
    if (!qty || qty <= 0) {
      await bot.sendMessage(chatId, t(lang, 'qty.invalid'));
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id: pending.productId },
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

    if (!product || !product.isActive || !product.salePrice || Number(product.stock) <= 0) {
      session.mode = 'IDLE';
      session.pendingQty = undefined;
      await bot.sendMessage(chatId, t(lang, 'qty.productUnavailable'));
      await this.showCatalog(bot, chatId, lang, pending.page);
      return;
    }

    if (qty > Number(product.stock)) {
      await bot.sendMessage(
        chatId,
        t(lang, 'qty.outOfStock', { name: this.escapeHtml(product.name), stock: this.formatQty(Number(product.stock)) }),
        { parse_mode: 'HTML' },
      );
      return;
    }

    const existing = session.cart.find((item) => item.productId === product.id);
    if (existing) {
      existing.qty = qty;
      existing.price = Number(product.salePrice);
      existing.name = product.name;
      existing.sku = product.sku;
      existing.unit = product.unit;
    } else {
      session.cart.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        price: Number(product.salePrice),
        qty,
      });
    }

    session.mode = 'IDLE';
    session.pendingQty = undefined;

    await bot.sendMessage(
      chatId,
      t(lang, 'qty.added', { name: this.escapeHtml(product.name), qty: this.formatQty(qty), unit: this.escapeHtml(product.unit || 'шт') }),
      { parse_mode: 'HTML' },
    );

    await this.showCart(bot, chatId, lang, undefined, t(lang, 'cart.updated'));
  }

  private async showCart(
    bot: TelegramBot,
    chatId: number,
    lang: Lang,
    messageId?: number,
    notice?: string,
  ): Promise<void> {
    const session = this.getSession(chatId);
    if (!session.cart.length) {
      await this.editOrSendMessage(
        bot,
        chatId,
        [
          notice ? `<i>${this.escapeHtml(notice)}</i>` : '',
          `<b>${t(lang, 'cart.empty')}</b>`,
        ].filter(Boolean).join('\n'),
        {
          messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: t(lang, 'menu.order'), callback_data: 'catalog:page:0' }],
              [{ text: t(lang, 'common.back'), callback_data: 'menu:home' }],
            ],
          },
        },
      );
      return;
    }

    const manager = session.selectedManagerId
      ? await prisma.user.findUnique({
        where: { id: session.selectedManagerId },
        select: { fullName: true },
      })
      : null;

    const rows = session.cart.map((item, index) =>
      `${index + 1}. ${t(lang, 'cart.itemLine', {
        name: this.escapeHtml(item.name),
        qty: this.formatQty(item.qty),
        unit: this.escapeHtml(item.unit),
        price: this.formatMoney(item.price),
        total: this.formatMoney(item.qty * item.price),
      })}`,
    );
    const total = session.cart.reduce((sum, item) => sum + item.qty * item.price, 0);

    const removeButtons: TelegramBot.InlineKeyboardButton[][] = [];
    let currentRow: TelegramBot.InlineKeyboardButton[] = [];
    session.cart.forEach((item, index) => {
      currentRow.push({
        text: `${t(lang, 'cart.removeButton')} ${index + 1}`,
        callback_data: `cart:remove:${item.productId}`,
      });
      if (currentRow.length === 4 || index === session.cart.length - 1) {
        removeButtons.push(currentRow);
        currentRow = [];
      }
    });

    const keyboard: TelegramBot.InlineKeyboardButton[][] = [...removeButtons];

    keyboard.push([
      { text: t(lang, 'cart.addMore'), callback_data: 'cart:addmore' },
      { text: t(lang, 'cart.clearButton'), callback_data: 'cart:clear' },
    ]);
    keyboard.push([
      { text: t(lang, 'manager.changeButton'), callback_data: 'manager:page:0' },
      { text: t(lang, 'cart.checkoutButton'), callback_data: 'cart:checkout' },
    ]);
    keyboard.push([{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        notice ? `<i>${this.escapeHtml(notice)}</i>` : '',
        `<b>${t(lang, 'cart.title')}</b>`,
        manager ? t(lang, 'manager.label', { name: this.escapeHtml(getFirstName(manager.fullName)) }) : t(lang, 'manager.notSelected'),
        '',
        ...rows,
        '',
        t(lang, 'cart.total', { total: this.formatMoney(total) }),
      ].filter(Boolean).join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      },
    );
  }

  private async startCheckout(bot: TelegramBot, chatId: number, session: CustomerSession, lang: Lang): Promise<void> {
    if (!session.cart.length) {
      await bot.sendMessage(chatId, t(lang, 'cart.empty'));
      return;
    }

    if (!session.selectedManagerId) {
      await bot.sendMessage(chatId, t(lang, 'checkout.needManager'));
      await this.showManagerPicker(bot, chatId, lang, 0);
      return;
    }

    if (!session.customerName) {
      session.mode = 'AWAITING_NAME';
      await bot.sendMessage(chatId, t(lang, 'checkout.askName'));
      return;
    }

    if (!session.phone) {
      session.mode = 'AWAITING_PHONE';
      await this.askPhone(bot, chatId, lang, t(lang, 'checkout.askPhone'));
      return;
    }

    await this.trySubmitOrder(bot, chatId, session, lang);
  }

  private async trySubmitOrder(bot: TelegramBot, chatId: number, session: CustomerSession, lang: Lang): Promise<void> {
    if (session.submittingOrder) {
      await bot.sendMessage(chatId, t(lang, 'checkout.inProgress'));
      return;
    }

    session.submittingOrder = true;
    try {
    if (!session.selectedManagerId || !session.customerName || !session.phone || !session.cart.length) {
      await bot.sendMessage(chatId, t(lang, 'checkout.missingData'));
      return;
    }

    const result = await createCustomerOrder({
      chatId,
      customerName: session.customerName,
      phone: session.phone,
      managerId: session.selectedManagerId,
      items: session.cart.map((item) => ({ productId: item.productId, qty: item.qty })),
      source: 'bot',
    });

    if (!result.ok) {
      if (result.reason === 'CLOSED') {
        await bot.sendMessage(
          chatId,
          [
            `<b>${t(lang, 'hours.closed', { reason: '' }).trim()}</b>`,
            t(lang, 'hours.currentTime', { time: result.hours.currentTimeText }),
            result.hours.reasonCode ? t(lang, `hours.reason.${result.hours.reasonCode}`) : '',
            '',
            t(lang, 'start.hours.monFri'),
            t(lang, 'start.hours.sat'),
            t(lang, 'start.hours.sun'),
          ].filter(Boolean).join('\n'),
          { parse_mode: 'HTML' },
        );
        return;
      }

      if (result.reason === 'MANAGER_UNAVAILABLE') {
        await bot.sendMessage(chatId, t(lang, 'manager.unavailable'));
        await this.showManagerPicker(bot, chatId, lang, 0);
        return;
      }

      if (result.reason === 'OUT_OF_STOCK') {
        await bot.sendMessage(
          chatId,
          t(lang, 'qty.outOfStock', {
            name: this.escapeHtml(result.product.name),
            stock: this.formatQty(result.product.stock),
          }),
          { parse_mode: 'HTML' },
        );
        await this.showCart(bot, chatId, lang);
        return;
      }

      if (result.reason === 'PRODUCT_UNAVAILABLE') {
        await bot.sendMessage(chatId, t(lang, 'qty.productUnavailable'), { parse_mode: 'HTML' });
        await this.showCart(bot, chatId, lang, undefined, t(lang, 'qty.productUnavailable'));
        return;
      }

      await bot.sendMessage(chatId, t(lang, 'checkout.missingData'));
      return;
    }

    const { manager, totalAmount } = result;

    await notifyManagerAboutOrder(bot, manager, result.dealId, chatId, {
      customerName: session.customerName,
      phone: session.phone,
      lines: result.lines,
    });

    await bot.sendMessage(
      chatId,
      [
        `<b>${t(lang, 'checkout.success.title')}</b>`,
        '',
        t(lang, 'checkout.success.manager', { name: this.escapeHtml(getFirstName(manager.fullName)) }),
        t(lang, 'cart.total', { total: this.formatMoney(totalAmount) }),
        t(lang, 'checkout.success.status', { status: customerStatusLabel(lang, 'NEW') }),
        t(lang, 'checkout.success.note'),
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: this.buildHomeKeyboard(lang),
      },
    );

    session.mode = 'IDLE';
    session.pendingQty = undefined;
    session.cart = [];
    } finally {
      session.submittingOrder = false;
    }
  }

  private async handleManagerContactConfirmation(
    bot: TelegramBot,
    query: TelegramBot.CallbackQuery,
    contacted: boolean,
  ): Promise<void> {
    if (!query.message?.chat || !query.data || !query.from) return;

    const [, dealId, customerChatIdRaw] = query.data.split(':');
    const managerUser = await prisma.user.findFirst({
      where: { telegramChatId: String(query.from.id), isActive: true },
      select: { id: true, fullName: true },
    });

    if (!managerUser) {
      await bot.answerCallbackQuery(query.id, { text: 'Сначала привяжите Telegram в CRM.' }).catch(() => {});
      return;
    }

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { id: true, title: true, managerId: true },
    });

    if (!deal || deal.managerId !== managerUser.id) {
      await bot.answerCallbackQuery(query.id, { text: 'Эта сделка вам не принадлежит.' }).catch(() => {});
      return;
    }

    await prisma.dealComment.create({
      data: {
        dealId: deal.id,
        authorId: managerUser.id,
        text: contacted
          ? 'Менеджер подтвердил в Telegram, что связался с клиентом.'
          : 'Менеджер отметил в Telegram, что пока не дозвонился до клиента.',
      },
    });

    await this.editOrSendMessage(
      bot,
      query.message.chat.id,
      [
        `<b>${this.escapeHtml(deal.title)}</b>`,
        '',
        contacted
          ? 'Статус обновлён: вы подтвердили контакт с клиентом.'
          : 'Статус обновлён: отмечено, что клиент пока недоступен.',
      ].join('\n'),
      {
        messageId: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'Открыть сделку в CRM', url: `${config.telegram.crmUrl}/deals/${deal.id}` }]],
        },
      },
    );

    const customerChatId = Number(customerChatIdRaw);
    if (Number.isFinite(customerChatId)) {
      const customerSession = this.getSession(customerChatId);
      const customerLang = await this.getLang(customerChatId, customerSession);
      const statusNote = contacted ? t(customerLang, 'checkout.success.note') : t(customerLang, 'manager.unavailable');
      await bot.sendMessage(customerChatId, `${getFirstName(managerUser.fullName)}: ${statusNote}`).catch(() => {});
    }
  }

  private async showOrderList(
    bot: TelegramBot,
    chatId: number,
    session: CustomerSession,
    lang: Lang,
    messageId?: number,
  ): Promise<void> {
    if (!session.phone) {
      session.mode = 'AWAITING_ORDERS_PHONE';
      await bot.sendMessage(chatId, t(lang, 'orders.askPhone'), {
        reply_markup: this.buildPhoneKeyboard(lang),
      });
      return;
    }

    const deals = await prisma.deal.findMany({
      where: {
        isArchived: false,
        client: this.buildReviewClientFilter(session.phone, chatId),
      },
      select: {
        id: true,
        title: true,
        amount: true,
        status: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (!deals.length) {
      await this.editOrSendMessage(
        bot,
        chatId,
        [
          `<b>${t(lang, 'orders.title')}</b>`,
          '',
          t(lang, 'orders.empty', { phone: this.escapeHtml(session.phone) }),
        ].join('\n'),
        {
          messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]],
          },
        },
      );
      return;
    }

    const dateFormatter = new Intl.DateTimeFormat(lang === 'uz' ? 'uz-UZ' : 'ru-RU', {
      timeZone: TASHKENT_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const lines: string[] = [];
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    const reviewableIds: string[] = [];

    deals.forEach((deal, index) => {
      const statusLabel = customerStatusLabel(lang, deal.status);
      lines.push(`${index + 1}. ${this.escapeHtml(deal.title)}`);
      lines.push(`   ${t(lang, 'orders.line', {
        date: dateFormatter.format(deal.createdAt),
        count: deal._count.items,
        total: this.formatMoney(Number(deal.amount)),
      })} — ${statusLabel}`);

      if (REVIEWABLE_DEAL_STATUSES.includes(deal.status)) {
        reviewableIds.push(deal.id);
        keyboard.push([{
          text: `${t(lang, 'orders.reviewButton')} — ${this.truncate(deal.title, 20)}`,
          callback_data: `review:deal:${deal.id}`,
        }]);
      }
    });

    session.reviewAllowedDealIds = reviewableIds;
    keyboard.push([{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        `<b>${t(lang, 'orders.title')}</b>`,
        '',
        ...lines,
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      },
    );
  }

  private async showReviewDealPicker(
    bot: TelegramBot,
    chatId: number,
    lang: Lang,
    phone: string,
    messageId?: number,
  ): Promise<void> {
    const session = this.getSession(chatId);
    const deals = await prisma.deal.findMany({
      where: {
        isArchived: false,
        status: { in: REVIEWABLE_DEAL_STATUSES },
        client: this.buildReviewClientFilter(phone, chatId),
      },
      select: {
        id: true,
        title: true,
        amount: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (!deals.length) {
      session.reviewAllowedDealIds = [];
      await this.editOrSendMessage(
        bot,
        chatId,
        [
          `<b>${t(lang, 'review.noOrders')}</b>`,
          '',
          t(lang, 'review.noOrdersBody', { phone: this.escapeHtml(phone) }),
        ].join('\n'),
        {
          messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]],
          },
        },
      );
      return;
    }

    session.reviewAllowedDealIds = deals.map((deal) => deal.id);

    const keyboard: TelegramBot.InlineKeyboardButton[][] = deals.map((deal) => [
      {
        text: `${this.truncate(deal.title, 24)} • ${this.formatMoney(Number(deal.amount))}`,
        callback_data: `review:deal:${deal.id}`,
      },
    ]);
    keyboard.push([{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        `<b>${t(lang, 'review.pickTitle')}</b>`,
        '',
        t(lang, 'review.pickSubtitle'),
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      },
    );
  }

  private async showReviewRatingPicker(
    bot: TelegramBot,
    chatId: number,
    session: CustomerSession,
    lang: Lang,
    dealId: string,
    messageId?: number,
  ): Promise<void> {
    if (!session.reviewAllowedDealIds?.includes(dealId)) {
      await this.editOrSendMessage(
        bot,
        chatId,
        t(lang, 'review.notAllowed'),
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, 'common.back'), callback_data: 'menu:review' }]],
          },
        },
      );
      return;
    }

    const deal = await prisma.deal.findFirst({
      where: {
        id: dealId,
        isArchived: false,
        status: { in: REVIEWABLE_DEAL_STATUSES },
        client: this.buildReviewClientFilter(session.phone, chatId),
      },
      select: { id: true, title: true },
    });

    if (!deal) {
      await this.editOrSendMessage(
        bot,
        chatId,
        t(lang, 'review.notAllowed'),
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, 'common.back'), callback_data: 'menu:home' }]],
          },
        },
      );
      return;
    }

    session.reviewDraft = {
      dealId,
      rating: 0,
    };

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        `<b>${this.escapeHtml(deal.title)}</b>`,
        '',
        t(lang, 'review.askRating'),
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [1, 2, 3, 4, 5].map((rating) => ({
              text: `${rating}`,
              callback_data: `review:rate:${rating}`,
            })),
            [{ text: t(lang, 'common.back'), callback_data: 'menu:review' }],
          ],
        },
      },
    );
  }

  private async saveReview(
    bot: TelegramBot,
    chatId: number,
    session: CustomerSession,
    lang: Lang,
    reviewText: string,
  ): Promise<void> {
    const draft = session.reviewDraft;
    if (!draft || draft.rating < 1 || draft.rating > 5) {
      session.mode = 'IDLE';
      session.reviewDraft = undefined;
      await bot.sendMessage(chatId, t(lang, 'review.saveFailed'));
      return;
    }

    const deal = await prisma.deal.findFirst({
      where: {
        id: draft.dealId,
        isArchived: false,
        status: { in: REVIEWABLE_DEAL_STATUSES },
        client: this.buildReviewClientFilter(session.phone, chatId),
      },
      select: { id: true, title: true, managerId: true },
    });

    if (!deal) {
      session.mode = 'IDLE';
      session.reviewDraft = undefined;
      await bot.sendMessage(chatId, t(lang, 'review.notAllowed'));
      return;
    }

    const systemActorId = await this.getSystemActorId(deal.managerId);
    const textBody = reviewText || 'Без текстового комментария.';

    try {
      await prisma.dealComment.create({
        data: {
          dealId: deal.id,
          authorId: systemActorId,
          text: [
            `Отзыв клиента из Telegram: ${draft.rating}/5`,
            `Телефон клиента: ${session.phone || 'не указан'}`,
            `Текст: ${textBody}`,
          ].join('\n'),
        },
      });
    } catch (err) {
      console.error('[Telegram customer bot] saveReview dealComment failed:', err);
      session.mode = 'IDLE';
      session.reviewDraft = undefined;
      await bot.sendMessage(
        chatId,
        t(lang, 'review.saveFailed'),
        { reply_markup: this.buildHomeKeyboard(lang) },
      );
      return;
    }

    await prisma.notification.create({
      data: {
        userId: deal.managerId,
        title: 'Новый отзыв из Telegram',
        body: `${draft.rating}/5 по сделке "${deal.title}".`,
        severity: draft.rating <= 2 ? 'WARNING' : 'INFO',
        link: `/deals/${deal.id}`,
        createdByUserId: systemActorId,
      },
    });

    pushService.sendPushToUser(deal.managerId, {
      title: 'Новый отзыв из Telegram',
      body: `${draft.rating}/5 по сделке "${deal.title}".`,
      url: `/deals/${deal.id}`,
      severity: draft.rating <= 2 ? 'WARNING' : 'INFO',
    }).catch(() => {});

    const manager = await prisma.user.findUnique({
      where: { id: deal.managerId },
      select: { telegramChatId: true },
    });

    if (manager?.telegramChatId) {
      await bot.sendMessage(
        manager.telegramChatId,
        [
          '<b>Новый отзыв клиента</b>',
          '',
          `Сделка: <b>${this.escapeHtml(deal.title)}</b>`,
          `Оценка: <b>${draft.rating}/5</b>`,
          `Комментарий: ${this.escapeHtml(textBody)}`,
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: 'Открыть сделку в CRM', url: `${config.telegram.crmUrl}/deals/${deal.id}` }]],
          },
        },
      ).catch(() => {});
    }

    session.mode = 'IDLE';
    session.reviewDraft = undefined;
    session.reviewAllowedDealIds = undefined;
    await bot.sendMessage(chatId, t(lang, 'review.thanks'), {
      reply_markup: this.buildHomeKeyboard(lang),
    });
  }

  private async askPhone(bot: TelegramBot, chatId: number, lang: Lang, text: string): Promise<void> {
    await bot.sendMessage(chatId, text, {
      reply_markup: this.buildPhoneKeyboard(lang),
    });
  }

  private buildHomeKeyboard(lang: Lang): TelegramBot.InlineKeyboardMarkup {
    const miniAppUrl = config.telegram.miniAppUrl;
    return {
      inline_keyboard: [
        // Мини-апп — основной путь: витрина с фото. Текстовый сценарий остаётся запасным.
        ...(miniAppUrl ? [[{ text: t(lang, 'menu.shop'), web_app: { url: miniAppUrl } }]] : []),
        [{ text: t(lang, 'menu.order'), callback_data: 'menu:order' }],
        [{ text: t(lang, 'menu.orders'), callback_data: 'menu:orders' }],
        [{ text: t(lang, 'menu.hours'), callback_data: 'menu:hours' }],
        [{ text: t(lang, 'menu.review'), callback_data: 'menu:review' }],
        [{ text: t(lang, 'menu.language'), callback_data: 'lang:switch' }],
      ],
    };
  }

  private buildPhoneKeyboard(lang: Lang): TelegramBot.ReplyKeyboardMarkup {
    return {
      keyboard: [
        [{ text: t(lang, 'common.sendPhoneButton'), request_contact: true }],
        [{ text: t(lang, 'common.cancelButton') }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  }

  private buildPaginationRow(prefix: 'manager' | 'catalog', currentPage: number, totalPages: number): TelegramBot.InlineKeyboardButton[] {
    const row: TelegramBot.InlineKeyboardButton[] = [];
    if (currentPage > 0) {
      row.push({ text: '◀️', callback_data: `${prefix}:page:${currentPage - 1}` });
    }

    row.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: `${prefix}:page:${currentPage}` });

    if (currentPage + 1 < totalPages) {
      row.push({ text: '▶️', callback_data: `${prefix}:page:${currentPage + 1}` });
    }

    return row;
  }

  private async editOrSendMessage(
    bot: TelegramBot,
    chatId: number,
    text: string,
    options: {
      messageId?: number;
      parse_mode?: TelegramBot.ParseMode;
      reply_markup?: TelegramBot.InlineKeyboardMarkup;
    },
  ): Promise<void> {
    const { messageId, ...rest } = options;
    if (messageId) {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          ...rest,
        });
        return;
      } catch {
        // Telegram sometimes refuses to edit old callback messages.
      }
    }

    await bot.sendMessage(chatId, text, rest);
  }

  private getBusinessHoursStatus(date = new Date()): BusinessHoursStatus {
    return getBusinessHoursStatus(date);
  }

  private normalizePhone(raw: string): string | null {
    return normalizeCustomerPhone(raw);
  }

  /**
   * Клиент «свой» для отзыва/списка заказов: совпадение телефона (в любом из форматов) или тег
   * Telegram-чата в notes (как при оформлении заказа через бота).
   */
  private buildReviewClientFilter(phone: string | null | undefined, chatId: number): Prisma.ClientWhereInput {
    return buildCustomerClientFilter(phone, chatId);
  }

  private parseQty(raw: string): number | null {
    const normalized = raw.replace(',', '.').trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  }

  private parsePositiveInt(raw: string, fallback = 0): number {
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  private formatMoney(value: number): string {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} so'm`;
  }

  private formatQty(value: number): string {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}…`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Ярлык считается снятым, если срок показа истёк. */
  private activeBadge(badge: string | null, badgeUntil: Date | null): string | null {
    if (!badge) return null;
    if (badgeUntil && badgeUntil.getTime() < Date.now()) return null;
    return badge;
  }

  private buildClientTelegramNote(chatId: number): string {
    return buildClientTelegramNote(chatId);
  }

  private mergeClientNotes(existingNotes: string | null, chatId: number): string {
    return mergeClientNotes(existingNotes, chatId);
  }

  private async getSystemActorId(fallbackUserId: string): Promise<string> {
    return getSystemActorId(fallbackUserId);
  }
}

export const telegramCustomerService = new TelegramCustomerService();
