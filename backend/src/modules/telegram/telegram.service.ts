import TelegramBot from 'node-telegram-bot-api';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { getFirstName } from '../../lib/name-utils';
import type { PushPayload } from '../push/push.service';
import { registerTelegramAdminCallbacks } from './telegram-admin-callback.handler';
import { registerTelegramWarehouseWeighHandlers } from './telegram-warehouse-weigh.handler';
import { createTelegramBot, registerWebhook } from './telegram-transport';

const LINK_SECRET = config.jwt.accessSecret + '_tg';

const SEVERITY_EMOJI: Record<string, string> = {
  URGENT: '\u{1F6A8}',
  WARNING: '\u26A0\uFE0F',
  INFO: '\u2139\uFE0F',
};

/** Обработчик личного текстового сообщения боту (не команды /start и /unlink). */
export type PrivateTextHandler = (msg: TelegramBot.Message) => Promise<void>;

/** Кнопка под сообщением: ссылка (относительный путь — в CRM) или действие с callback_data (до 64 байт). */
export type TgButton = { text: string; url: string } | { text: string; callback: string };

class TelegramService {
  private bot: TelegramBot | null = null;
  private botUsername: string | null = null;
  private privateTextHandlers: PrivateTextHandler[] = [];
  private privateVoiceHandlers: PrivateTextHandler[] = [];
  private callbackHandlers: { prefix: string; handler: (query: TelegramBot.CallbackQuery) => Promise<void> }[] = [];

  constructor() {
    if (!config.telegram.botToken) {
      console.log('Telegram bot token not set, skipping bot init');
      const w = !!config.telegram.groupWarehouseChatId;
      const p = !!config.telegram.groupProductionChatId;
      const f = !!config.telegram.groupFinanceChatId;
      if (w || p || f) {
        console.warn(
          '[Telegram] В Environment заданы TELEGRAM_GROUP_* но нет TELEGRAM_BOT_TOKEN — в группы ничего не отправится.',
        );
      }
      return;
    }
    this.bot = createTelegramBot(config.telegram.botToken);
    this.setupHandlers();
    registerWebhook(this.bot, '/api/telegram/webhook/admin', 'Admin bot');
    this.bot.getMe().then((me) => {
      this.botUsername = me.username || null;
      console.log(`Telegram bot @${this.botUsername} started`);
      const w = !!config.telegram.groupWarehouseChatId;
      const p = !!config.telegram.groupProductionChatId;
      const f = !!config.telegram.groupFinanceChatId;
      if (!w && !p && !f) {
        console.warn(
          '[Telegram] Уведомления в группы ВЫКЛЮЧЕНЫ: задайте TELEGRAM_GROUP_WAREHOUSE_CHAT_ID / PRODUCTION / FINANCE на сервере (Render → Environment).',
        );
      } else {
        console.log(`[Telegram] Групповые алерты: склад=${w} производство=${p} финансы=${f}`);
      }
    }).catch((err) => {
      console.error('Telegram bot getMe failed:', err.message);
    });
    // Кнопка меню (Web App) настраивается ОДИН РАЗ вручную через @BotFather (Bot Settings →
    // Menu Button), не через API при каждом старте: сырой вызов setChatMenuButton молча
    // откатывается Telegram обратно к типу "commands", если Mini App не зарегистрирован через
    // BotFather — а повторные вызовы при каждом деплое (рестарт процесса) только расшатывают
    // уже закреплённую через BotFather настройку. См. историю фиксов в git log этого файла.
  }

  private setupHandlers() {
    if (!this.bot) return;

    // /start TOKEN — link user
    this.bot.onText(/\/start (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const token = match![1];

      try {
        const payload = jwt.verify(token, LINK_SECRET) as { userId: string; purpose: string };
        if (payload.purpose !== 'telegram-link') {
          this.bot!.sendMessage(chatId, '\u274C \u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0442\u043E\u043A\u0435\u043D. \u041F\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u0432 CRM \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 "\u041F\u0440\u0438\u0432\u044F\u0437\u0430\u0442\u044C Telegram".');
          return;
        }

        // Check if this chatId is already linked to another user
        const existing = await prisma.user.findFirst({ where: { telegramChatId: String(chatId) } });
        if (existing && existing.id !== payload.userId) {
          await prisma.user.update({ where: { id: existing.id }, data: { telegramChatId: null } });
        }

        const user = await prisma.user.update({
          where: { id: payload.userId },
          data: { telegramChatId: String(chatId) },
        });

        this.bot!.sendMessage(chatId,
          `\u2705 \u0423\u0441\u043F\u0435\u0448\u043D\u043E \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D\u043E!\n\n\u0412\u044B \u0431\u0443\u0434\u0435\u0442\u0435 \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F CRM \u043A\u0430\u043A <b>${getFirstName(user.fullName)}</b>.\n\n\u0414\u043B\u044F \u043E\u0442\u0432\u044F\u0437\u043A\u0438 \u043D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 /unlink`,
          { parse_mode: 'HTML' },
        );
      } catch {
        this.bot!.sendMessage(chatId, '\u274C \u0422\u043E\u043A\u0435\u043D \u043F\u0440\u0438\u0432\u044F\u0437\u043A\u0438 CRM \u043D\u0435\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u0435\u043D \u0438\u043B\u0438 \u0438\u0441\u0442\u0451\u043A. \u041F\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u0432 CRM \u0438 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0441\u0441\u044B\u043B\u043A\u0443 \u043F\u0440\u0438\u0432\u044F\u0437\u043A\u0438.');
      }
    });

    // /start without token
    this.bot.onText(/^\/start$/, (msg) => {
      this.bot!.sendMessage(msg.chat.id,
        '\u{1F44B} \u042D\u0442\u043E \u0431\u043E\u0442 CRM Polygraph Business.\n\n\u0414\u043B\u044F \u043F\u0440\u0438\u0432\u044F\u0437\u043A\u0438 \u043F\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u0432 CRM \u2192 \u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u2192 "\u041F\u0440\u0438\u0432\u044F\u0437\u0430\u0442\u044C Telegram".',
        { parse_mode: 'HTML' },
      );
    });

    // /unlink
    this.bot.onText(/\/unlink/, async (msg) => {
      const chatId = msg.chat.id;
      const user = await prisma.user.findFirst({ where: { telegramChatId: String(chatId) } });
      if (!user) {
        this.bot!.sendMessage(chatId, '\u0412\u0430\u0448 \u0430\u043A\u043A\u0430\u0443\u043D\u0442 \u043D\u0435 \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D.');
        return;
      }
      await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: null } });
      this.bot!.sendMessage(chatId, '\u2705 \u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u043E\u0442\u0432\u044F\u0437\u0430\u043D. \u0412\u044B \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442\u0435 \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F.');
    });

    registerTelegramAdminCallbacks(this.bot);
    registerTelegramWarehouseWeighHandlers(this.bot);

    // Личка: отдаём модулям, которые подписались (РОП-агент). Группы сюда не попадают —
    // там своя переписка и ответы складу (telegram-warehouse-weigh.handler).
    this.bot.on('message', (msg) => {
      if (msg.chat.type !== 'private') return;
      if (msg.voice || msg.audio) {
        for (const handler of this.privateVoiceHandlers) {
          handler(msg).catch((err) => console.error('[Telegram] private voice handler failed:', (err as Error).message));
        }
        return;
      }
      if (!msg.text) return;
      if (msg.text.startsWith('/start') || msg.text.startsWith('/unlink')) return;
      for (const handler of this.privateTextHandlers) {
        handler(msg).catch((err) => console.error('[Telegram] private message handler failed:', (err as Error).message));
      }
    });

    // Кнопки модулей по префиксу callback_data; чужие префиксы обрабатывают свои хендлеры выше.
    this.bot.on('callback_query', (query) => {
      const entry = this.callbackHandlers.find((h) => query.data?.startsWith(h.prefix));
      if (!entry) return;
      entry.handler(query).catch((err) => {
        console.error('[Telegram] callback handler failed:', (err as Error).message);
        this.bot?.answerCallbackQuery(query.id, { text: 'Не получилось, попробуйте ещё раз' }).catch(() => {});
      });
    });
  }

  /** Подписка на нажатия кнопок с callback_data, начинающимся с prefix. */
  onCallback(prefix: string, handler: (query: TelegramBot.CallbackQuery) => Promise<void>): void {
    this.callbackHandlers.push({ prefix, handler });
  }

  private toKeyboard(buttons?: TgButton[][]): TelegramBot.InlineKeyboardMarkup | undefined {
    if (!buttons?.length) return undefined;
    return {
      inline_keyboard: buttons.map((row) => row.map((b) => ('url' in b
        ? { text: b.text, url: b.url.startsWith('http') ? b.url : `${config.telegram.crmUrl}${b.url}` }
        : { text: b.text, callback_data: b.callback }))),
    };
  }

  /** Убрать кнопки у сообщения (после того как решение принято). */
  async clearButtons(chatId: string | number, messageId: number): Promise<void> {
    await this.bot?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: this.toTelegramTarget(chatId), message_id: messageId })
      .catch(() => {});
  }

  async answerCallback(queryId: string, text?: string): Promise<void> {
    await this.bot?.answerCallbackQuery(queryId, text ? { text } : undefined).catch(() => {});
  }

  /** Заменить текст и кнопки уже отправленного сообщения (пустой список — убрать кнопки). */
  async editHtmlMessage(chatId: string | number, messageId: number, html: string, buttons?: TgButton[][]): Promise<void> {
    if (!this.bot) return;
    await this.bot.editMessageText(html, {
      chat_id: this.toTelegramTarget(chatId),
      message_id: messageId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: this.toKeyboard(buttons) ?? { inline_keyboard: [] },
    }).catch((err) => console.warn(`[Telegram] editHtmlMessage failed chat_id=${chatId}:`, (err as Error).message));
  }

  /** Подписка на личные текстовые сообщения боту. */
  onPrivateText(handler: PrivateTextHandler): void {
    this.privateTextHandlers.push(handler);
  }

  /** Подписка на голосовые и аудио в личке. */
  onPrivateVoice(handler: PrivateTextHandler): void {
    this.privateVoiceHandlers.push(handler);
  }

  /** Скачать файл из Telegram в папку; возвращает путь. */
  async downloadFile(fileId: string, dir: string): Promise<string> {
    if (!this.bot) throw new Error('Telegram bot is not configured');
    return this.bot.downloadFile(fileId, dir);
  }

  /**
   * HTML-сообщение в личный чат. Длинный текст режется на части по 4096 символов
   * (лимит Telegram) по границам строк; кнопка — под последней частью.
   * @returns message_id последней части или null.
   */
  async sendHtmlToChat(
    chatId: string | number,
    html: string,
    buttons?: TgButton[][],
  ): Promise<number | null> {
    if (!this.bot) return null;
    const parts: string[] = [];
    let current = '';
    for (const line of html.split('\n')) {
      if (current && current.length + line.length + 1 > 4000) {
        parts.push(current);
        current = '';
      }
      current = current ? `${current}\n${line}` : line;
    }
    if (current) parts.push(current);

    const keyboard = this.toKeyboard(buttons);
    let lastId: number | null = null;
    try {
      for (const [i, part] of parts.entries()) {
        const isLast = i === parts.length - 1;
        const sent = await this.bot.sendMessage(this.toTelegramTarget(chatId), part, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(isLast && keyboard ? { reply_markup: keyboard } : {}),
        });
        lastId = sent.message_id;
      }
    } catch (err) {
      console.error(`[Telegram] sendHtmlToChat failed chat_id=${chatId}:`, (err as Error).message);
    }
    return lastId;
  }

  async sendTyping(chatId: string | number): Promise<void> {
    await this.bot?.sendChatAction(this.toTelegramTarget(chatId), 'typing').catch(() => {});
  }

  async deleteChatMessage(chatId: string | number, messageId: number): Promise<void> {
    await this.bot?.deleteMessage(this.toTelegramTarget(chatId), messageId).catch(() => {});
  }

  private formatMessage(payload: PushPayload): string {
    const emoji = SEVERITY_EMOJI[payload.severity || 'INFO'] || SEVERITY_EMOJI.INFO;
    let text = `${emoji} <b>${this.escapeHtml(payload.title)}</b>\n\n${this.escapeHtml(payload.body)}`;
    return text;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private toTelegramTarget(chatId: string | number): string | number {
    return typeof chatId === 'number'
      ? chatId
      : (/^-?\d+$/.test(String(chatId)) ? Number(chatId) : chatId);
  }

  private getMigrateToChatId(err: unknown): string | null {
    const e = err as { response?: { body?: { parameters?: { migrate_to_chat_id?: number | string } } } };
    const migrated = e.response?.body?.parameters?.migrate_to_chat_id;
    if (migrated == null) return null;
    return String(migrated);
  }

  /**
   * Send HTML to a group/supergroup. chatId from env (often negative), e.g. -100xxxxxxxxxx.
   * @returns Telegram message_id или null при ошибке / нет бота.
   */
  async sendGroupHtmlMessage(chatId: string, html: string, linkPath?: string): Promise<number | null> {
    if (!this.bot) {
      console.warn('[Telegram] sendGroupHtmlMessage: бот не инициализирован (нет TELEGRAM_BOT_TOKEN?)');
      return null;
    }
    if (!chatId) return null;
    try {
      const reply_markup = linkPath ? this.buildInlineKeyboard(linkPath) : undefined;
      const target = this.toTelegramTarget(chatId);
      const sent = await this.bot.sendMessage(target, html, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup,
      });
      return typeof sent.message_id === 'number' ? sent.message_id : null;
    } catch (err: unknown) {
      const migratedChatId = this.getMigrateToChatId(err);
      if (migratedChatId) {
        try {
          const reply_markup = linkPath ? this.buildInlineKeyboard(linkPath) : undefined;
          const resent = await this.bot.sendMessage(this.toTelegramTarget(migratedChatId), html, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup,
          });
          console.warn(`[Telegram] sendGroupHtmlMessage: chat ${chatId} migrated to ${migratedChatId}. Update TELEGRAM_GROUP_*_CHAT_ID.`);
          return typeof resent.message_id === 'number' ? resent.message_id : null;
        } catch (retryErr: unknown) {
          const re = retryErr as { message?: string; response?: { body?: { description?: string; error_code?: number } } };
          const rb = re.response?.body;
          console.error('[Telegram] sendGroupHtmlMessage retry after migration failed chat_id=', migratedChatId, rb?.description || re.message);
          return null;
        }
      }
      const e = err as { message?: string; response?: { body?: { description?: string; error_code?: number } } };
      const body = e.response?.body;
      console.error(
        '[Telegram] sendGroupHtmlMessage failed chat_id=',
        chatId,
        body?.description || e.message,
        body?.error_code != null ? `(code ${body.error_code})` : '',
        body && typeof body === 'object' ? JSON.stringify(body) : '',
      );
      return null;
    }
  }

  async sendGroupDocument(
    chatId: string,
    file: Buffer | string,
    filename: string,
    caption?: string,
  ): Promise<boolean> {
    if (!this.bot) {
      console.warn('[Telegram] sendGroupDocument: бот не инициализирован');
      return false;
    }
    if (!chatId) return false;
    // node-telegram-bot-api принимает Buffer/Stream/путь ВТОРЫМ аргументом напрямую,
    // а имя файла — отдельным, четвёртым (fileOptions). Форма `{ source }` — это синтаксис
    // Telegraf: с ней буфер уезжал в URL и Telegram отвечал «414 Request-URI Too Large».
    const sendOptions = {
      caption: caption ? this.escapeHtml(caption) : undefined,
      parse_mode: caption ? ('HTML' as const) : undefined,
    };
    const fileOptions = typeof file === 'string' ? undefined : { filename, contentType: 'application/octet-stream' };
    try {
      const target = this.toTelegramTarget(chatId);
      await this.bot.sendDocument(target, file, sendOptions, fileOptions);
      return true;
    } catch (err: unknown) {
      const migratedChatId = this.getMigrateToChatId(err);
      if (migratedChatId) {
        try {
          await this.bot.sendDocument(
            this.toTelegramTarget(migratedChatId),
            file,
            sendOptions,
            fileOptions,
          );
          console.warn(`[Telegram] sendGroupDocument: chat ${chatId} migrated to ${migratedChatId}. Update TELEGRAM_GROUP_*_CHAT_ID.`);
          return true;
        } catch {
          // fall through
        }
      }
      const e = err as { message?: string; response?: { body?: { description?: string; error_code?: number } } };
      const body = e.response?.body;
      console.error(
        '[Telegram] sendGroupDocument failed chat_id=',
        chatId,
        body?.description || e.message,
        body?.error_code != null ? `(code ${body.error_code})` : '',
      );
      return false;
    }
  }

  /**
   * HTML в любой чат (личка или группа) + inline-кнопки. Опционально строка со ссылкой в CRM.
   */
  async sendHtmlMessageWithKeyboard(
    chatId: string,
    html: string,
    keyboard: TelegramBot.InlineKeyboardMarkup,
    linkPath?: string,
  ): Promise<number | null> {
    if (!this.bot) {
      console.warn('[Telegram] sendHtmlMessageWithKeyboard: бот не инициализирован');
      return null;
    }
    if (!chatId) return null;
    try {
      const rows = [...(keyboard.inline_keyboard || [])];
      if (linkPath) {
        const fullUrl = linkPath.startsWith('http') ? linkPath : `${config.telegram.crmUrl}${linkPath}`;
        rows.push([{ text: '\u{1F4CB} \u041E\u0442\u043A\u0440\u044B\u0442\u044C CRM', url: fullUrl }]);
      }
      const reply_markup: TelegramBot.InlineKeyboardMarkup = { inline_keyboard: rows };
      const target = this.toTelegramTarget(chatId);
      const sent = await this.bot.sendMessage(target, html, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup,
      });
      return typeof sent.message_id === 'number' ? sent.message_id : null;
    } catch (err: unknown) {
      const migratedChatId = this.getMigrateToChatId(err);
      if (migratedChatId) {
        try {
          const rows = [...(keyboard.inline_keyboard || [])];
          if (linkPath) {
            const fullUrl = linkPath.startsWith('http') ? linkPath : `${config.telegram.crmUrl}${linkPath}`;
            rows.push([{ text: '\u{1F4CB} Открыть CRM', url: fullUrl }]);
          }
          const reply_markup: TelegramBot.InlineKeyboardMarkup = { inline_keyboard: rows };
          const resent = await this.bot.sendMessage(this.toTelegramTarget(migratedChatId), html, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup,
          });
          console.warn(`[Telegram] sendHtmlMessageWithKeyboard: chat ${chatId} migrated to ${migratedChatId}. Update TELEGRAM_GROUP_*_CHAT_ID.`);
          return typeof resent.message_id === 'number' ? resent.message_id : null;
        } catch {
          return null;
        }
      }
      const e = err as { message?: string; response?: { body?: { description?: string; error_code?: number } } };
      const body = e.response?.body;
      console.error(
        '[Telegram] sendHtmlMessageWithKeyboard failed chat_id=',
        chatId,
        body?.description || e.message,
      );
      return null;
    }
  }

  /**
   * Обновить текст сообщения в группе (кнопка CRM сохраняется при переданном linkPath).
   */
  async editGroupHtmlMessage(
    chatId: string,
    messageId: number,
    html: string,
    linkPath?: string,
  ): Promise<boolean> {
    if (!this.bot) return false;
    if (!chatId || !Number.isFinite(messageId)) return false;
    try {
      const target = this.toTelegramTarget(chatId);
      const reply_markup = linkPath ? this.buildInlineKeyboard(linkPath) : undefined;
      await this.bot.editMessageText(html, {
        chat_id: target,
        message_id: messageId,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup,
      });
      return true;
    } catch (err: unknown) {
      const migratedChatId = this.getMigrateToChatId(err);
      if (migratedChatId) {
        try {
          const reply_markup = linkPath ? this.buildInlineKeyboard(linkPath) : undefined;
          await this.bot.editMessageText(html, {
            chat_id: this.toTelegramTarget(migratedChatId),
            message_id: messageId,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup,
          });
          console.warn(`[Telegram] editGroupHtmlMessage: chat ${chatId} migrated to ${migratedChatId}. Update TELEGRAM_GROUP_*_CHAT_ID.`);
          return true;
        } catch {
          // fall through
        }
      }
      const e = err as { message?: string; response?: { body?: { description?: string } } };
      const desc = e.response?.body?.description || e.message || '';
      if (/message is not modified/i.test(desc)) {
        return true;
      }
      console.warn(
        '[Telegram] editGroupHtmlMessage failed chat_id=',
        chatId,
        'msg=',
        messageId,
        desc,
      );
      return false;
    }
  }

  /**
   * Обновить текст сообщения в группе с произвольной inline-клавиатурой (кнопка CRM
   * дописывается отдельным рядом, если передан linkPath) — вариант editGroupHtmlMessage
   * для постов с кнопками действий (напр. «Ввести вес» на складе).
   */
  async editGroupHtmlMessageWithKeyboard(
    chatId: string,
    messageId: number,
    html: string,
    keyboard: TelegramBot.InlineKeyboardMarkup,
    linkPath?: string,
  ): Promise<boolean> {
    if (!this.bot) return false;
    if (!chatId || !Number.isFinite(messageId)) return false;
    const buildMarkup = (): TelegramBot.InlineKeyboardMarkup => {
      const rows = [...(keyboard.inline_keyboard || [])];
      if (linkPath) {
        const fullUrl = linkPath.startsWith('http') ? linkPath : `${config.telegram.crmUrl}${linkPath}`;
        rows.push([{ text: '\u{1F4CB} Открыть CRM', url: fullUrl }]);
      }
      return { inline_keyboard: rows };
    };
    try {
      const target = this.toTelegramTarget(chatId);
      await this.bot.editMessageText(html, {
        chat_id: target,
        message_id: messageId,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: buildMarkup(),
      });
      return true;
    } catch (err: unknown) {
      const migratedChatId = this.getMigrateToChatId(err);
      if (migratedChatId) {
        try {
          await this.bot.editMessageText(html, {
            chat_id: this.toTelegramTarget(migratedChatId),
            message_id: messageId,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: buildMarkup(),
          });
          console.warn(`[Telegram] editGroupHtmlMessageWithKeyboard: chat ${chatId} migrated to ${migratedChatId}. Update TELEGRAM_GROUP_*_CHAT_ID.`);
          return true;
        } catch {
          // fall through
        }
      }
      const e = err as { message?: string; response?: { body?: { description?: string } } };
      const desc = e.response?.body?.description || e.message || '';
      if (/message is not modified/i.test(desc)) {
        return true;
      }
      console.warn(
        '[Telegram] editGroupHtmlMessageWithKeyboard failed chat_id=',
        chatId,
        'msg=',
        messageId,
        desc,
      );
      return false;
    }
  }

  /**
   * Удалить сообщение бота в группе (нужны права администратора у бота).
   */
  async deleteGroupMessage(chatId: string, messageId: number): Promise<boolean> {
    if (!this.bot || !chatId || !Number.isFinite(messageId)) {
      return false;
    }
    try {
      const target = this.toTelegramTarget(chatId);
      await this.bot.deleteMessage(target, messageId);
      return true;
    } catch (err: unknown) {
      const migratedChatId = this.getMigrateToChatId(err);
      if (migratedChatId) {
        try {
          await this.bot.deleteMessage(this.toTelegramTarget(migratedChatId), messageId);
          console.warn(`[Telegram] deleteGroupMessage: chat ${chatId} migrated to ${migratedChatId}. Update TELEGRAM_GROUP_*_CHAT_ID.`);
          return true;
        } catch {
          // fall through
        }
      }
      const e = err as { message?: string; response?: { body?: { description?: string; error_code?: number } } };
      const body = e.response?.body;
      console.warn(
        '[Telegram] deleteGroupMessage failed chat_id=',
        chatId,
        'msg=',
        messageId,
        body?.description || e.message,
      );
      return false;
    }
  }

  private buildInlineKeyboard(url?: string) {
    if (!url) return undefined;
    const fullUrl = url.startsWith('http') ? url : `${config.telegram.crmUrl}${url}`;
    return {
      inline_keyboard: [[{ text: '\u{1F4CB} \u041E\u0442\u043A\u0440\u044B\u0442\u044C CRM', url: fullUrl }]],
    };
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.bot) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });

    if (!user?.telegramChatId) return;

    try {
      await this.bot.sendMessage(user.telegramChatId, this.formatMessage(payload), {
        parse_mode: 'HTML',
        reply_markup: this.buildInlineKeyboard(payload.url),
      });
    } catch (err) {
      console.error(`Telegram sendToUser failed for ${userId}:`, (err as Error).message);
    }
  }

  async sendToRole(role: Role, payload: PushPayload): Promise<void> {
    if (!this.bot) return;

    const users = await prisma.user.findMany({
      where: { role, isActive: true, telegramChatId: { not: null } },
      select: { telegramChatId: true },
    });

    const text = this.formatMessage(payload);
    const reply_markup = this.buildInlineKeyboard(payload.url);

    await Promise.allSettled(
      users.map((u) =>
        this.bot!.sendMessage(u.telegramChatId!, text, { parse_mode: 'HTML', reply_markup }).catch(() => {}),
      ),
    );
  }

  async sendToRoles(roles: Role[], payload: PushPayload): Promise<void> {
    if (!this.bot) return;

    const users = await prisma.user.findMany({
      where: { role: { in: roles }, isActive: true, telegramChatId: { not: null } },
      select: { telegramChatId: true },
    });

    const text = this.formatMessage(payload);
    const reply_markup = this.buildInlineKeyboard(payload.url);

    await Promise.allSettled(
      users.map((u) =>
        this.bot!.sendMessage(u.telegramChatId!, text, { parse_mode: 'HTML', reply_markup }).catch(() => {}),
      ),
    );
  }

  generateLinkToken(userId: string): string {
    return jwt.sign({ userId, purpose: 'telegram-link' }, LINK_SECRET, { expiresIn: '10m' });
  }

  getBotUsername(): string | null {
    return this.botUsername;
  }

  handleWebhookUpdate(update: TelegramBot.Update): void {
    this.bot?.processUpdate(update);
  }

  /**
   * Тест доставки в группы (склад / производство / финансы). Только для диагностики.
   */
  async sendTestGroupMessages(): Promise<
    Array<{ label: string; chatId: string; ok: boolean; error?: string }>
  > {
    const targets: { label: string; chatId: string; envKey: string }[] = [
      { label: 'warehouse', chatId: config.telegram.groupWarehouseChatId, envKey: 'TELEGRAM_GROUP_WAREHOUSE_CHAT_ID' },
      { label: 'production', chatId: config.telegram.groupProductionChatId, envKey: 'TELEGRAM_GROUP_PRODUCTION_CHAT_ID' },
      { label: 'ready_for_shipment', chatId: config.telegram.groupReadyForShipmentChatId, envKey: 'TELEGRAM_GROUP_READY_FOR_SHIPMENT_CHAT_ID' },
      { label: 'finance', chatId: config.telegram.groupFinanceChatId, envKey: 'TELEGRAM_GROUP_FINANCE_CHAT_ID' },
    ];

    const results: Array<{ label: string; chatId: string; ok: boolean; error?: string }> = [];

    for (const t of targets) {
      if (!t.chatId) {
        results.push({
          label: t.label,
          chatId: '(пусто)',
          ok: false,
          error: `Не задан ${t.envKey}`,
        });
        continue;
      }

      if (!this.bot) {
        results.push({
          label: t.label,
          chatId: t.chatId,
          ok: false,
          error: 'TELEGRAM_BOT_TOKEN не задан — бот не запущен',
        });
        continue;
      }

      const text = [
        '🧪 <b>Тест CRM Polygraph</b>',
        '',
        `Канал: <b>${this.escapeHtml(t.label)}</b>`,
        `chat_id: <code>${this.escapeHtml(t.chatId)}</code>`,
        `Время (UTC): <code>${this.escapeHtml(new Date().toISOString())}</code>`,
        '',
        'Если видите это сообщение — бот доходит до группы.',
      ].join('\n');

      try {
        const target = this.toTelegramTarget(t.chatId);
        await this.bot.sendMessage(target, text, { parse_mode: 'HTML', disable_web_page_preview: true });
        results.push({ label: t.label, chatId: t.chatId, ok: true });
      } catch (err: unknown) {
        const migratedChatId = this.getMigrateToChatId(err);
        if (migratedChatId) {
          try {
            await this.bot.sendMessage(this.toTelegramTarget(migratedChatId), text, { parse_mode: 'HTML', disable_web_page_preview: true });
            results.push({
              label: t.label,
              chatId: t.chatId,
              ok: true,
              error: `chat migrated to ${migratedChatId} (update ${t.envKey})`,
            });
            continue;
          } catch {
            // continue to regular error formatting
          }
        }
        const e = err as { message?: string; response?: { body?: { description?: string; error_code?: number } } };
        const body = e.response?.body;
        const msg = body?.description || e.message || 'Unknown error';
        results.push({
          label: t.label,
          chatId: t.chatId,
          ok: false,
          error: body?.error_code != null ? `${msg} (code ${body.error_code})` : msg,
        });
      }
    }

    return results;
  }
}

export const telegramService = new TelegramService();
