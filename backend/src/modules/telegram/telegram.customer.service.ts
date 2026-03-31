import { DealStatus, Role } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { pushService } from '../push/push.service';

const PAGE_SIZE = 6;
const TASHKENT_TIME_ZONE = 'Asia/Tashkent';
const REVIEWABLE_DEAL_STATUSES: DealStatus[] = ['CLOSED', 'SHIPPED'];

type SessionMode =
  | 'IDLE'
  | 'AWAITING_QTY'
  | 'AWAITING_NAME'
  | 'AWAITING_PHONE'
  | 'AWAITING_REVIEW_PHONE'
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

interface BusinessHoursStatus {
  isOpen: boolean;
  currentTimeText: string;
  reason?: string;
}

export class TelegramCustomerService {
  private sessions = new Map<number, CustomerSession>();
  private systemActorId: string | null | undefined;

  async handleStart(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const firstName = msg.from?.first_name;

    await bot.sendMessage(
      chatId,
      [
        '<b>Polygraph Business Bot</b>',
        '',
        firstName
          ? `Здравствуйте, ${this.escapeHtml(firstName)}. Через этого бота можно оформить заказ, выбрать менеджера и оставить отзыв.`
          : 'Через этого бота можно оформить заказ, выбрать менеджера и оставить отзыв.',
        '',
        'Заказы принимаются:',
        'Пн-Пт: 09:00-18:00',
        'Сб: 10:00-18:00',
        'Вс: выходной',
        '',
        'Если вы сотрудник CRM, привязка Telegram по-прежнему работает через ссылку из CRM.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: this.buildHomeKeyboard(),
      },
    );
  }

  async handleMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
    if (!msg.chat || msg.from?.is_bot) return;

    const chatId = msg.chat.id;
    const session = this.getSession(chatId);

    if (msg.text?.startsWith('/')) {
      await this.handleCommand(bot, msg, session);
      return;
    }

    if (msg.contact) {
      const normalized = this.normalizePhone(msg.contact.phone_number);
      if (!normalized) {
        await bot.sendMessage(chatId, 'Не удалось распознать номер телефона. Отправьте номер в формате +998901234567.');
        return;
      }

      session.phone = normalized;
      await bot.sendMessage(chatId, `Номер сохранён: <b>${this.escapeHtml(normalized)}</b>`, {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true },
      });

      if (session.mode === 'AWAITING_PHONE') {
        session.mode = 'IDLE';
        await this.trySubmitOrder(bot, chatId, session);
        return;
      }

      if (session.mode === 'AWAITING_REVIEW_PHONE') {
        session.mode = 'IDLE';
        await this.showReviewDealPicker(bot, chatId, normalized);
      }

      return;
    }

    const text = msg.text?.trim();
    if (!text) return;

    if (text.toLowerCase() === 'отмена') {
      session.mode = 'IDLE';
      session.pendingQty = undefined;
      session.reviewDraft = undefined;
      session.reviewAllowedDealIds = undefined;
      await bot.sendMessage(chatId, 'Текущее действие отменено.', {
        reply_markup: { remove_keyboard: true },
      });
      await this.showHome(bot, chatId);
      return;
    }

    if (session.mode === 'AWAITING_QTY' && session.pendingQty) {
      await this.handleQuantityInput(bot, chatId, session, text);
      return;
    }

    if (session.mode === 'AWAITING_NAME') {
      session.customerName = text;
      session.mode = 'AWAITING_PHONE';
      await this.askPhone(bot, chatId, 'Теперь отправьте номер телефона, чтобы менеджер мог связаться с вами.');
      return;
    }

    if (session.mode === 'AWAITING_PHONE') {
      const normalized = this.normalizePhone(text);
      if (!normalized) {
        await bot.sendMessage(chatId, 'Не понял номер. Отправьте его в формате +998901234567 или через кнопку "Отправить номер".');
        return;
      }

      session.phone = normalized;
      session.mode = 'IDLE';
      await bot.sendMessage(chatId, `Номер сохранён: <b>${this.escapeHtml(normalized)}</b>`, {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true },
      });
      await this.trySubmitOrder(bot, chatId, session);
      return;
    }

    if (session.mode === 'AWAITING_REVIEW_PHONE') {
      const normalized = this.normalizePhone(text);
      if (!normalized) {
        await bot.sendMessage(chatId, 'Для поиска заказов нужен корректный номер телефона: +998901234567.');
        return;
      }

      session.phone = normalized;
      session.mode = 'IDLE';
      await bot.sendMessage(chatId, `Ищу ваши заказы по номеру <b>${this.escapeHtml(normalized)}</b>.`, {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true },
      });
      await this.showReviewDealPicker(bot, chatId, normalized);
      return;
    }

    if (session.mode === 'AWAITING_REVIEW_TEXT' && session.reviewDraft) {
      const reviewText = text === '-' ? '' : text;
      await this.saveReview(bot, chatId, session, reviewText);
      return;
    }

    await bot.sendMessage(chatId, 'Используйте меню ниже, чтобы оформить заказ или оставить отзыв.', {
      reply_markup: this.buildHomeKeyboard(),
    });
  }

  async handleCallbackQuery(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.message?.chat || !query.data) return;

    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const session = this.getSession(chatId);

    try {
      if (query.data === 'menu:home') {
        session.mode = 'IDLE';
        session.pendingQty = undefined;
        session.reviewDraft = undefined;
        session.reviewAllowedDealIds = undefined;
        session.currentCategory = null;
        await this.showHome(bot, chatId, messageId);
        return;
      }

      if (query.data === 'menu:hours') {
        await this.showBusinessHours(bot, chatId, messageId);
        return;
      }

      if (query.data === 'menu:order') {
        await this.showManagerPicker(bot, chatId, 0, messageId);
        return;
      }

      if (query.data === 'menu:review') {
        session.reviewDraft = undefined;
        session.reviewAllowedDealIds = undefined;
        if (session.phone) {
          await this.showReviewDealPicker(bot, chatId, session.phone, messageId);
        } else {
          session.mode = 'AWAITING_REVIEW_PHONE';
          await bot.sendMessage(chatId, 'Чтобы оставить отзыв, отправьте номер телефона, который вы указывали в заказе.', {
            reply_markup: this.buildPhoneKeyboard(),
          });
        }
        return;
      }

      if (query.data.startsWith('manager:page:')) {
        const page = this.parsePositiveInt(query.data.split(':')[2] || '0', 0);
        await this.showManagerPicker(bot, chatId, page, messageId);
        return;
      }

      if (query.data.startsWith('manager:pick:')) {
        const managerId = query.data.split(':')[2];
        session.selectedManagerId = managerId;
        if (session.cart.length === 0) {
          await this.showCatalog(bot, chatId, 0, messageId, 'Менеджер выбран. Теперь добавьте товары в заказ.');
        } else {
          await this.showCart(bot, chatId, messageId, 'Менеджер обновлён.');
        }
        return;
      }

      if (query.data === 'catalog:cats') {
        session.currentCategory = null;
        await this.showCatalog(bot, chatId, 0, messageId);
        return;
      }

      if (query.data.startsWith('catalog:cat:')) {
        const catIndex = this.parsePositiveInt(query.data.split(':')[2] || '0', -1);
        if (session.categories && catIndex >= 0 && catIndex < session.categories.length) {
          session.currentCategory = session.categories[catIndex];
          await this.showCatalog(bot, chatId, 0, messageId);
        } else {
          await this.showCatalog(bot, chatId, 0, messageId, 'Категория не найдена.');
        }
        return;
      }

      if (query.data.startsWith('catalog:page:')) {
        const page = this.parsePositiveInt(query.data.split(':')[2] || '0', 0);
        await this.showCatalog(bot, chatId, page, messageId);
        return;
      }

      if (query.data.startsWith('catalog:pick:')) {
        const [, , productId, pageToken] = query.data.split(':');
        const page = this.parsePositiveInt(pageToken || '0', 0);
        await this.askQuantity(bot, chatId, session, productId, page, messageId);
        return;
      }

      if (query.data === 'cart:view') {
        await this.showCart(bot, chatId, messageId);
        return;
      }

      if (query.data === 'cart:clear') {
        session.cart = [];
        await this.showCatalog(bot, chatId, 0, messageId, 'Корзина очищена.');
        return;
      }

      if (query.data.startsWith('cart:remove:')) {
        const productId = query.data.split(':')[2];
        session.cart = session.cart.filter((item) => item.productId !== productId);
        await this.showCart(bot, chatId, messageId, 'Товар удалён из корзины.');
        return;
      }

      if (query.data === 'cart:checkout') {
        if (session.submittingOrder) {
          await bot.answerCallbackQuery(query.id, { text: 'Заказ уже отправляется, подождите несколько секунд.' }).catch(() => {});
          return;
        }
        await this.startCheckout(bot, chatId, session);
        return;
      }

      if (query.data === 'cart:addmore') {
        await this.showCatalog(bot, chatId, 0, messageId);
        return;
      }

      if (query.data.startsWith('review:deal:')) {
        const dealId = query.data.split(':')[2];
        await this.showReviewRatingPicker(bot, chatId, dealId, messageId);
        return;
      }

      if (query.data.startsWith('review:rate:')) {
        const rating = this.parsePositiveInt(query.data.split(':')[2] || '0', 0);
        if (rating < 1 || rating > 5) {
          await bot.answerCallbackQuery(query.id, { text: 'Оценка должна быть от 1 до 5.' });
          return;
        }

        if (!session.reviewDraft?.dealId) {
          await bot.answerCallbackQuery(query.id, { text: 'Сначала выберите заказ для отзыва.' }).catch(() => {});
          if (session.phone) {
            await this.showReviewDealPicker(bot, chatId, session.phone, messageId);
          } else {
            await this.showHome(bot, chatId, messageId);
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
            `<b>Оценка: ${rating}/5</b>`,
            '',
            'Напишите короткий отзыв одним сообщением.',
            'Если текста нет, отправьте <code>-</code>.',
          ].join('\n'),
          {
            messageId,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: 'Отмена', callback_data: 'menu:home' }]],
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

  private async handleCommand(bot: TelegramBot, msg: TelegramBot.Message, session: CustomerSession): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    if (text === '/menu') {
      session.mode = 'IDLE';
      session.pendingQty = undefined;
      session.reviewDraft = undefined;
      session.reviewAllowedDealIds = undefined;
      session.currentCategory = null;
      await this.showHome(bot, chatId);
      return;
    }

    if (text === '/hours') {
      await this.showBusinessHours(bot, chatId);
      return;
    }

    if (text === '/order') {
      await this.showManagerPicker(bot, chatId, 0);
      return;
    }

    if (text === '/cart') {
      await this.showCart(bot, chatId);
      return;
    }

    if (text === '/review') {
      if (session.phone) {
        await this.showReviewDealPicker(bot, chatId, session.phone);
      } else {
        session.mode = 'AWAITING_REVIEW_PHONE';
        await bot.sendMessage(chatId, 'Чтобы оставить отзыв, отправьте номер телефона, который использовали в заказе.', {
          reply_markup: this.buildPhoneKeyboard(),
        });
      }
    }
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

  private async showHome(bot: TelegramBot, chatId: number, messageId?: number): Promise<void> {
    const hours = this.getBusinessHoursStatus();
    const summary = hours.isOpen
      ? `Сейчас заказы <b>принимаются</b>. Местное время: <b>${hours.currentTimeText}</b>.`
      : `Сейчас заказы <b>не принимаются</b>. Местное время: <b>${hours.currentTimeText}</b>.`;

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        '<b>Главное меню</b>',
        '',
        summary,
        '',
        'Выберите действие:',
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: this.buildHomeKeyboard(),
      },
    );
  }

  private async showBusinessHours(bot: TelegramBot, chatId: number, messageId?: number): Promise<void> {
    const hours = this.getBusinessHoursStatus();
    const statusLine = hours.isOpen
      ? 'Сейчас приём заказов <b>открыт</b>.'
      : `Сейчас приём заказов <b>закрыт</b>${hours.reason ? `: ${this.escapeHtml(hours.reason)}` : ''}.`;

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        '<b>График приёма заказов</b>',
        '',
        statusLine,
        `Местное время: <b>${hours.currentTimeText}</b>`,
        '',
        'Пн-Пт: 09:00-18:00',
        'Сб: 10:00-18:00',
        'Вс: выходной',
        '',
        'Сам бот работает 24/7, но оформить заказ можно только в эти часы.',
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'Назад в меню', callback_data: 'menu:home' }]],
        },
      },
    );
  }

  private async showManagerPicker(
    bot: TelegramBot,
    chatId: number,
    page = 0,
    messageId?: number,
  ): Promise<void> {
    const managers = await prisma.user.findMany({
      where: { role: 'MANAGER', isActive: true },
      select: { id: true, fullName: true, telegramChatId: true },
      orderBy: { fullName: 'asc' },
    });

    if (!managers.length) {
      await this.editOrSendMessage(
        bot,
        chatId,
        'Сейчас нет активных менеджеров для выбора. Попробуйте позже.',
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: 'Назад в меню', callback_data: 'menu:home' }]],
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
        text: manager.telegramChatId
          ? `👤 ${this.truncate(manager.fullName, 28)}`
          : `👤 ${this.truncate(manager.fullName, 28)} (CRM)`,
        callback_data: `manager:pick:${manager.id}`,
      },
    ]);

    if (totalPages > 1) {
      keyboard.push(this.buildPaginationRow('manager', safePage, totalPages));
    }

    keyboard.push([{ text: 'Назад в меню', callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        '<b>Выберите менеджера</b>',
        '',
        'Заказ будет сразу закреплён за выбранным менеджером.',
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

      const categories = dbCategories.map((p) => p.category || 'Без категории').sort();
      session.categories = categories;

      if (!categories.length) {
        await this.editOrSendMessage(
          bot,
          chatId,
          'В каталоге сейчас нет доступных товаров.',
          {
            messageId,
            reply_markup: {
              inline_keyboard: [[{ text: 'Назад в меню', callback_data: 'menu:home' }]],
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
        { text: `🧺 Корзина (${session.cart.length})`, callback_data: 'cart:view' },
        { text: '👤 Менеджер', callback_data: 'manager:page:0' },
      ]);
      keyboard.push([{ text: 'Назад в меню', callback_data: 'menu:home' }]);

      await this.editOrSendMessage(
        bot,
        chatId,
        [
          notice ? `<i>${this.escapeHtml(notice)}</i>` : '',
          '✨ <b>Каталог товаров</b>',
          selectedManager ? `Менеджер: <b>${this.escapeHtml(selectedManager.fullName)}</b>` : 'Менеджер пока не выбран.',
          '',
          'Выберите категорию:',
        ].filter(Boolean).join('\n'),
        {
          messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        },
      );
      return;
    }

    const isNoCategory = session.currentCategory === 'Без категории';
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
      },
      orderBy: { name: 'asc' },
    });

    if (!products.length) {
      session.currentCategory = null;
      await this.showCatalog(bot, chatId, 0, messageId, 'В этой категории не осталось товаров.');
      return;
    }

    const totalPages = Math.ceil(products.length / PAGE_SIZE);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * PAGE_SIZE;
    const pageProducts = products.slice(start, start + PAGE_SIZE);

    const productLines = pageProducts.map((p, index) => 
      `${index + 1}. <b>${this.escapeHtml(p.name)}</b>\n      Цена: ${this.formatMoney(Number(p.salePrice || 0))} | В наличии`
    );

    const productButtons: TelegramBot.InlineKeyboardButton[][] = [];
    let currentRow: TelegramBot.InlineKeyboardButton[] = [];
    for (let i = 0; i < pageProducts.length; i++) {
        currentRow.push({
            text: `➕ ${i + 1}`,
            callback_data: `catalog:pick:${pageProducts[i].id}:${safePage}`,
        });
        if (currentRow.length === 3 || i === pageProducts.length - 1) {
            productButtons.push(currentRow);
            currentRow = [];
        }
    }

    const keyboard: TelegramBot.InlineKeyboardButton[][] = [...productButtons];

    if (totalPages > 1) {
      keyboard.push(this.buildPaginationRow('catalog', safePage, totalPages));
    }

    keyboard.push([{ text: '📁 Все категории', callback_data: 'catalog:cats' }]);
    
    keyboard.push([
      { text: `🧺 Корзина (${session.cart.length})`, callback_data: 'cart:view' },
      { text: '👤 Менеджер', callback_data: 'manager:page:0' },
    ]);
    keyboard.push([{ text: 'Назад в меню', callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        notice ? `<i>${this.escapeHtml(notice)}</i>` : '',
        `📁 <b>${this.escapeHtml(session.currentCategory)}</b>`,
        selectedManager ? `Менеджер: <b>${this.escapeHtml(selectedManager.fullName)}</b>` : 'Менеджер пока не выбран.',
        '',
        ...productLines,
        '',
        'Выберите номер товара из кнопок ниже:',
      ].filter(Boolean).join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      },
    );
  }

  private async askQuantity(
    bot: TelegramBot,
    chatId: number,
    session: CustomerSession,
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
        'Этот товар сейчас недоступен. Выберите другой.',
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: 'Вернуться в каталог', callback_data: `catalog:page:${page}` }]],
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
        `Артикул: <code>${this.escapeHtml(product.sku)}</code>`,
        `Цена: <b>${this.formatMoney(Number(product.salePrice))}</b>`,
        `Статус: <b>В наличии</b>`,
        '',
        'Отправьте количество одним сообщением. Например: <code>100</code>.',
      ].join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Вернуться в каталог', callback_data: `catalog:page:${page}` }],
            [{ text: 'Открыть корзину', callback_data: 'cart:view' }],
          ],
        },
      },
    );
  }

  private async handleQuantityInput(
    bot: TelegramBot,
    chatId: number,
    session: CustomerSession,
    rawInput: string,
  ): Promise<void> {
    const pending = session.pendingQty;
    if (!pending) {
      session.mode = 'IDLE';
      return;
    }

    const qty = this.parseQty(rawInput);
    if (!qty || qty <= 0) {
      await bot.sendMessage(chatId, 'Количество должно быть больше нуля. Пример: 100 или 12.5');
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
      await bot.sendMessage(chatId, 'Товар уже недоступен. Пожалуйста, выберите другой.');
      await this.showCatalog(bot, chatId, pending.page);
      return;
    }

    if (qty > Number(product.stock)) {
      await bot.sendMessage(
        chatId,
        `К сожалению, такого количества сейчас нет в наличии. Пожалуйста, укажите меньшее количество.`,
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
      [
        `<b>${this.escapeHtml(product.name)}</b> добавлен в корзину.`,
        `Количество: <b>${this.formatQty(qty)} ${this.escapeHtml(product.unit || 'шт')}</b>`,
        `Сумма по позиции: <b>${this.formatMoney(qty * Number(product.salePrice))}</b>`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    );

    await this.showCart(bot, chatId, undefined, 'Товар добавлен.');
  }

  private async showCart(
    bot: TelegramBot,
    chatId: number,
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
          '<b>Корзина пуста</b>',
          '',
          'Сначала добавьте товары из каталога.',
        ].filter(Boolean).join('\n'),
        {
          messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Открыть каталог', callback_data: 'catalog:page:0' }],
              [{ text: 'Назад в меню', callback_data: 'menu:home' }],
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
      `${index + 1}. ${this.escapeHtml(item.name)} - ${this.formatQty(item.qty)} ${this.escapeHtml(item.unit)} x ${this.formatMoney(item.price)}`,
    );
    const total = session.cart.reduce((sum, item) => sum + item.qty * item.price, 0);

    const removeButtons: TelegramBot.InlineKeyboardButton[][] = [];
    let currentRow: TelegramBot.InlineKeyboardButton[] = [];
    session.cart.forEach((item, index) => {
      currentRow.push({
        text: `❌ ${index + 1}`,
        callback_data: `cart:remove:${item.productId}`,
      });
      if (currentRow.length === 4 || index === session.cart.length - 1) {
        removeButtons.push(currentRow);
        currentRow = [];
      }
    });

    const keyboard: TelegramBot.InlineKeyboardButton[][] = [...removeButtons];

    keyboard.push([
      { text: 'Добавить ещё', callback_data: 'cart:addmore' },
      { text: 'Очистить', callback_data: 'cart:clear' },
    ]);
    keyboard.push([
      { text: 'Сменить менеджера', callback_data: 'manager:page:0' },
      { text: 'Оформить заказ', callback_data: 'cart:checkout' },
    ]);
    keyboard.push([{ text: 'Назад в меню', callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        notice ? `<i>${this.escapeHtml(notice)}</i>` : '',
        '<b>Корзина</b>',
        manager ? `Менеджер: <b>${this.escapeHtml(manager.fullName)}</b>` : 'Менеджер пока не выбран.',
        '',
        ...rows,
        '',
        `Итого: <b>${this.formatMoney(total)}</b>`,
      ].filter(Boolean).join('\n'),
      {
        messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      },
    );
  }

  private async startCheckout(bot: TelegramBot, chatId: number, session: CustomerSession): Promise<void> {
    if (!session.cart.length) {
      await bot.sendMessage(chatId, 'Корзина пустая. Сначала добавьте товары.');
      return;
    }

    if (!session.selectedManagerId) {
      await bot.sendMessage(chatId, 'Сначала выберите менеджера.');
      await this.showManagerPicker(bot, chatId, 0);
      return;
    }

    if (!session.customerName) {
      session.mode = 'AWAITING_NAME';
      await bot.sendMessage(chatId, 'Напишите ваше имя или название компании одним сообщением.');
      return;
    }

    if (!session.phone) {
      session.mode = 'AWAITING_PHONE';
      await this.askPhone(bot, chatId, 'Отправьте номер телефона, чтобы менеджер мог с вами связаться.');
      return;
    }

    await this.trySubmitOrder(bot, chatId, session);
  }

  private async trySubmitOrder(bot: TelegramBot, chatId: number, session: CustomerSession): Promise<void> {
    if (session.submittingOrder) {
      await bot.sendMessage(chatId, 'Заказ уже отправляется, подождите несколько секунд.');
      return;
    }

    session.submittingOrder = true;
    try {
    const hours = this.getBusinessHoursStatus();
    if (!hours.isOpen) {
      await bot.sendMessage(
        chatId,
        [
          '<b>Сейчас приём заказов закрыт</b>',
          `Местное время: <b>${hours.currentTimeText}</b>`,
          hours.reason ? this.escapeHtml(hours.reason) : '',
          '',
          'Вы можете оформить заказ позже:',
          'Пн-Пт: 09:00-18:00',
          'Сб: 10:00-18:00',
          'Вс: выходной',
        ].filter(Boolean).join('\n'),
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (!session.selectedManagerId || !session.customerName || !session.phone || !session.cart.length) {
      await bot.sendMessage(chatId, 'Для оформления заказа не хватает данных. Проверьте корзину, менеджера и контакты.');
      return;
    }

    const manager = await prisma.user.findFirst({
      where: { id: session.selectedManagerId, role: 'MANAGER', isActive: true },
      select: { id: true, fullName: true, telegramChatId: true },
    });

    if (!manager) {
      await bot.sendMessage(chatId, 'Выбранный менеджер сейчас недоступен. Пожалуйста, выберите другого.');
      await this.showManagerPicker(bot, chatId, 0);
      return;
    }

    const uniqueProductIds = [...new Set(session.cart.map((item) => item.productId))];
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

    for (const item of session.cart) {
      const product = productById.get(item.productId);
      if (!product || !product.isActive || !product.salePrice || Number(product.stock) <= 0) {
        await bot.sendMessage(chatId, `Товар "${this.escapeHtml(item.name)}" сейчас недоступен. Обновите корзину.`, {
          parse_mode: 'HTML',
        });
        await this.showCart(bot, chatId, undefined, 'Некоторые позиции стали недоступны. Проверьте корзину.');
        return;
      }
      if (item.qty > Number(product.stock)) {
        await bot.sendMessage(
          chatId,
          `Для товара "${this.escapeHtml(product.name)}" указано большее количество, чем сейчас есть в наличии.`,
          { parse_mode: 'HTML' },
        );
        await this.showCart(bot, chatId, undefined, 'Проверьте количество в корзине и попробуйте снова.');
        return;
      }
      item.price = Number(product.salePrice);
      item.name = product.name;
      item.sku = product.sku;
      item.unit = product.unit;
    }

    const totalAmount = session.cart.reduce((sum, item) => sum + item.qty * item.price, 0);
    const systemActorId = await this.getSystemActorId(manager.id);
    const tag = this.buildClientTelegramNote(chatId);

    const result = await prisma.$transaction(async (tx) => {
      const existingClient = await tx.client.findFirst({
        where: {
          isArchived: false,
          OR: [
            { phone: session.phone! },
            { notes: { contains: tag } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      const client = existingClient
        ? await tx.client.update({
          where: { id: existingClient.id },
          data: {
            companyName: session.customerName!,
            contactName: session.customerName!,
            phone: session.phone!,
            managerId: manager.id,
            notes: this.mergeClientNotes(existingClient.notes, chatId),
          },
        })
        : await tx.client.create({
          data: {
            companyName: session.customerName!,
            contactName: session.customerName!,
            phone: session.phone!,
            managerId: manager.id,
            notes: this.mergeClientNotes(null, chatId),
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
          terms: `Заказ создан через Telegram-бот. Клиент: ${session.customerName}. Телефон: ${session.phone}.`,
        },
      });

      for (const item of session.cart) {
        await tx.dealItem.create({
          data: {
            dealId: deal.id,
            productId: item.productId,
            requestedQty: item.qty,
            price: item.price,
            lineTotal: item.qty * item.price,
            requestComment: 'Заказ из Telegram-бота',
            dealDate: new Date(),
          },
        });
      }

      await tx.dealComment.create({
        data: {
          dealId: deal.id,
          authorId: systemActorId,
          text: [
            'Новый заказ поступил из Telegram-бота.',
            `Клиент: ${session.customerName}`,
            `Телефон: ${session.phone}`,
            `Chat ID: ${chatId}`,
          ].join('\n'),
        },
      });

      await tx.notification.create({
        data: {
          userId: manager.id,
          title: 'Новый заказ из Telegram-бота',
          body: `${session.customerName} оформил заказ на ${this.formatMoney(totalAmount)}. Нужно связаться с клиентом.`,
          severity: 'WARNING',
          link: `/deals/${deal.id}`,
          createdByUserId: systemActorId,
        },
      });

      return { dealId: deal.id };
    });

    pushService.sendPushToUser(manager.id, {
      title: 'Новый заказ из Telegram-бота',
      body: `${session.customerName} оформил заказ на ${this.formatMoney(totalAmount)}.`,
      url: `/deals/${result.dealId}`,
      severity: 'WARNING',
    }).catch(() => {});

    await this.notifyManager(bot, manager, result.dealId, chatId, session);

    await bot.sendMessage(
      chatId,
      [
        '<b>Заказ принят</b>',
        '',
        `Менеджер: <b>${this.escapeHtml(manager.fullName)}</b>`,
        `Сумма: <b>${this.formatMoney(totalAmount)}</b>`,
        'Мы уже передали заказ менеджеру. Он свяжется с вами в рабочее время.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: this.buildHomeKeyboard(),
      },
    );

    session.mode = 'IDLE';
    session.pendingQty = undefined;
    session.cart = [];
    } finally {
      session.submittingOrder = false;
    }
  }

  private async notifyManager(
    bot: TelegramBot,
    manager: { id: string; fullName: string; telegramChatId: string | null },
    dealId: string,
    customerChatId: number,
    session: CustomerSession,
  ): Promise<void> {
    if (!manager.telegramChatId) return;

    const orderLines = session.cart
      .slice(0, 6)
      .map((item) => `• ${item.name}: ${this.formatQty(item.qty)} ${item.unit} x ${this.formatMoney(item.price)}`)
      .join('\n');

    await bot.sendMessage(
      manager.telegramChatId,
      [
        '<b>Новый заказ из Telegram</b>',
        '',
        `Клиент: <b>${this.escapeHtml(session.customerName || '-')}</b>`,
        `Телефон: <b>${this.escapeHtml(session.phone || '-')}</b>`,
        '',
        orderLines,
        '',
        'После контакта с клиентом нажмите кнопку подтверждения.',
      ].join('\n'),
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
      await bot.sendMessage(
        customerChatId,
        contacted
          ? `Менеджер ${managerUser.fullName} уже взял ваш заказ в работу и связался с вами.`
          : `Менеджер ${managerUser.fullName} пытался связаться с вами по заказу, но пока не дозвонился.`,
      ).catch(() => {});
    }
  }

  private async showReviewDealPicker(
    bot: TelegramBot,
    chatId: number,
    phone: string,
    messageId?: number,
  ): Promise<void> {
    const session = this.getSession(chatId);
    const deals = await prisma.deal.findMany({
      where: {
        isArchived: false,
        status: { in: REVIEWABLE_DEAL_STATUSES },
        client: { phone },
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
          '<b>Заказы не найдены</b>',
          '',
          `По номеру <b>${this.escapeHtml(phone)}</b> пока нет заказов в CRM.`,
        ].join('\n'),
        {
          messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: 'Назад в меню', callback_data: 'menu:home' }]],
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
    keyboard.push([{ text: 'Назад в меню', callback_data: 'menu:home' }]);

    await this.editOrSendMessage(
      bot,
      chatId,
      [
        '<b>Выберите заказ для отзыва</b>',
        '',
        'Сохраним отзыв прямо в карточке сделки.',
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
    dealId: string,
    messageId?: number,
  ): Promise<void> {
    const session = this.getSession(chatId);
    if (!session.phone || !session.reviewAllowedDealIds?.includes(dealId)) {
      await this.editOrSendMessage(
        bot,
        chatId,
        'Этот заказ недоступен для отзыва. Выберите заказ из списка.',
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: 'Назад к заказам', callback_data: 'menu:review' }]],
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
        client: { phone: session.phone },
      },
      select: { id: true, title: true },
    });

    if (!deal) {
      await this.editOrSendMessage(
        bot,
        chatId,
        'Сделка для отзыва не найдена.',
        {
          messageId,
          reply_markup: {
            inline_keyboard: [[{ text: 'Назад в меню', callback_data: 'menu:home' }]],
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
        'Выберите оценку от 1 до 5.',
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
            [{ text: 'Назад', callback_data: 'menu:review' }],
          ],
        },
      },
    );
  }

  private async saveReview(
    bot: TelegramBot,
    chatId: number,
    session: CustomerSession,
    reviewText: string,
  ): Promise<void> {
    const draft = session.reviewDraft;
    if (!draft || draft.rating < 1 || draft.rating > 5) {
      session.mode = 'IDLE';
      session.reviewDraft = undefined;
      await bot.sendMessage(chatId, 'Не удалось сохранить отзыв. Попробуйте ещё раз из меню.');
      return;
    }

    const deal = await prisma.deal.findFirst({
      where: {
        id: draft.dealId,
        isArchived: false,
        status: { in: REVIEWABLE_DEAL_STATUSES },
        client: session.phone ? { phone: session.phone } : undefined,
      },
      select: { id: true, title: true, managerId: true },
    });

    if (!deal) {
      session.mode = 'IDLE';
      session.reviewDraft = undefined;
      await bot.sendMessage(chatId, 'Сделка для отзыва уже недоступна.');
      return;
    }

    const systemActorId = await this.getSystemActorId(deal.managerId);
    const textBody = reviewText || 'Без текстового комментария.';

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
    await bot.sendMessage(chatId, 'Спасибо. Отзыв сохранён и передан менеджеру.', {
      reply_markup: this.buildHomeKeyboard(),
    });
  }

  private async askPhone(bot: TelegramBot, chatId: number, text: string): Promise<void> {
    await bot.sendMessage(chatId, text, {
      reply_markup: this.buildPhoneKeyboard(),
    });
  }

  private buildHomeKeyboard(): TelegramBot.InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: 'Оформить заказ', callback_data: 'menu:order' }],
        [{ text: 'Часы приёма заказов', callback_data: 'menu:hours' }],
        [{ text: 'Оставить отзыв', callback_data: 'menu:review' }],
      ],
    };
  }

  private buildPhoneKeyboard(): TelegramBot.ReplyKeyboardMarkup {
    return {
      keyboard: [
        [{ text: 'Отправить номер', request_contact: true }],
        [{ text: 'Отмена' }],
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
      return {
        isOpen: false,
        currentTimeText,
        reason: 'воскресенье — выходной',
      };
    }

    const opensAt = weekday === 'Sat' ? 10 * 60 : 9 * 60;
    const closesAt = 18 * 60;
    if (currentMinutes < opensAt || currentMinutes >= closesAt) {
      return {
        isOpen: false,
        currentTimeText,
        reason: weekday === 'Sat'
          ? 'по субботам заказы принимаются с 10:00 до 18:00'
          : 'заказы принимаются с 09:00 до 18:00',
      };
    }

    return { isOpen: true, currentTimeText };
  }

  private normalizePhone(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 9) return `+998${digits}`;
    if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
    if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
    return null;
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

  private buildClientTelegramNote(chatId: number): string {
    return `[TG_CHAT_ID:${chatId}]`;
  }

  private mergeClientNotes(existingNotes: string | null, chatId: number): string {
    const tag = this.buildClientTelegramNote(chatId);
    if (!existingNotes) return tag;
    if (existingNotes.includes(tag)) return existingNotes;
    return `${existingNotes}\n${tag}`.trim();
  }

  private async getSystemActorId(fallbackUserId: string): Promise<string> {
    if (this.systemActorId !== undefined) {
      return this.systemActorId || fallbackUserId;
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

    this.systemActorId = actor?.id || null;
    return this.systemActorId || fallbackUserId;
  }
}

export const telegramCustomerService = new TelegramCustomerService();
