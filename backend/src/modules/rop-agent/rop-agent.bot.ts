import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../lib/config';
import { createTelegramBot, registerWebhook } from '../telegram/telegram-transport';

/**
 * Отдельный Telegram-бот РОП-агента (HOS_BOT_TOKEN), не CRM-бот.
 *
 * - Личка: разговор с агентом, голосовые, записи звонков, быстрые кнопки.
 * - Группа HOS_GROUP_ID: сюда уходят утренняя сводка и сигналы; в группе агент
 *   отвечает, когда его упоминают (@бот) или отвечают на его сообщение.
 * - Писать боту и нажимать кнопки могут только Telegram ID из HOS_ALLOWED_IDS.
 */

/** Кнопка под сообщением: ссылка (относительный путь — в CRM) или действие с callback_data (до 64 байт). */
export type TgButton = { text: string; url: string } | { text: string; callback: string };

type MessageHandler = (msg: TelegramBot.Message) => Promise<void>;
type CallbackHandler = (query: TelegramBot.CallbackQuery) => Promise<void>;

class AgentBot {
  private bot: TelegramBot | null = null;
  private me: { id: number; username: string } | null = null;
  private handlers: Record<'text' | 'voice' | 'file' | 'group', MessageHandler[]> = { text: [], voice: [], file: [], group: [] };
  private callbacks: { prefix: string; handler: CallbackHandler }[] = [];

  constructor() {
    if (!config.hos.botToken) {
      console.log('[HOS bot] HOS_BOT_TOKEN не задан — РОП-агент в Telegram выключен');
      return;
    }
    this.bot = createTelegramBot(config.hos.botToken);
    registerWebhook(this.bot, '/api/telegram/webhook/hos', 'HOS bot');
    this.bot.on('message', (msg) => this.route(msg));
    this.bot.on('callback_query', (query) => {
      const entry = this.callbacks.find((c) => query.data?.startsWith(c.prefix));
      if (!entry) return;
      if (!this.isAllowed(query.from.id)) {
        this.answerCallback(query.id, 'Нет доступа');
        return;
      }
      entry.handler(query).catch((err) => {
        console.error('[HOS bot] callback failed:', (err as Error).message);
        this.answerCallback(query.id, 'Не получилось, попробуйте ещё раз');
      });
    });
    this.bot.getMe().then((me) => {
      this.me = { id: me.id, username: me.username ?? '' };
      console.log(`[HOS bot] @${this.me.username} started, group=${config.hos.groupId || '—'}, allowed=${config.hos.allowedIds.join(',')}`);
      return this.setCommands();
    }).catch((err) => console.error('[HOS bot] getMe failed:', (err as Error).message));
  }

  /** Меню команд («/» в Telegram): в личке — всё, в группах — то, что уместно при всех. */
  private async setCommands(): Promise<void> {
    if (!this.bot) return;
    const common = [
      { command: 'status', description: 'Бот на месте? Проверка' },
      { command: 'digest', description: 'Сводка за вчера' },
      { command: 'alerts', description: 'Сигналы, ждущие решения' },
      { command: 'help', description: 'Что умеет агент' },
    ];
    const setMyCommands = this.bot.setMyCommands.bind(this.bot) as (cmds: TelegramBot.BotCommand[], opts?: object) => Promise<boolean>;
    await setMyCommands([
      { command: 'menu', description: 'Быстрые кнопки' },
      ...common,
      { command: 'memory', description: 'Что помнит агент' },
      { command: 'new', description: 'Новый разговор' },
    ], { scope: { type: 'all_private_chats' } }).catch(() => {});
    await setMyCommands(common, { scope: { type: 'all_group_chats' } }).catch(() => {});
  }

  isAllowed(telegramUserId: number | string | undefined): boolean {
    return telegramUserId != null && config.hos.allowedIds.includes(String(telegramUserId));
  }

  get groupId(): string {
    return config.hos.groupId;
  }

  get enabled(): boolean {
    return !!this.bot;
  }

  /** Обращение к боту в группе: упоминание @бота, ответ на его сообщение или команда. */
  private addressedInGroup(msg: TelegramBot.Message): boolean {
    const text = msg.text ?? '';
    if (text.startsWith('/')) {
      // «/status@другой_бот» — не нам; «/status» и «/status@наш_бот» — нам.
      const target = text.match(/^\/\w+@(\w+)/)?.[1];
      return !target || target.toLowerCase() === this.me?.username.toLowerCase();
    }
    if (this.me && msg.reply_to_message?.from?.id === this.me.id) return true;
    return !!this.me?.username && text.toLowerCase().includes(`@${this.me.username.toLowerCase()}`);
  }

  /** Текст без упоминания бота («@hos_bot сколько долгов» → «сколько долгов»). */
  stripMention(text: string): string {
    if (!this.me?.username) return text.trim();
    return text.replace(new RegExp(`@${this.me.username}\\b`, 'gi'), '').trim();
  }

  private route(msg: TelegramBot.Message): void {
    if (!this.isAllowed(msg.from?.id)) return;
    const run = (kind: keyof AgentBot['handlers']) => {
      for (const h of this.handlers[kind]) {
        h(msg).catch((err) => console.error(`[HOS bot] ${kind} handler failed:`, (err as Error).message));
      }
    };
    if (msg.chat.type === 'private') {
      // Голосовое, записанное в Telegram, — сказанное агенту; аудиофайл или документ — запись звонка.
      if (msg.voice) return run('voice');
      if (msg.audio || msg.document) return run('file');
      if (msg.text) return run('text');
      return;
    }
    if (String(msg.chat.id) === this.groupId && msg.text && this.addressedInGroup(msg)) run('group');
  }

  onPrivateText(h: MessageHandler) { this.handlers.text.push(h); }
  onPrivateVoice(h: MessageHandler) { this.handlers.voice.push(h); }
  onPrivateFile(h: MessageHandler) { this.handlers.file.push(h); }
  onGroupText(h: MessageHandler) { this.handlers.group.push(h); }
  onCallback(prefix: string, handler: CallbackHandler) { this.callbacks.push({ prefix, handler }); }

  handleWebhookUpdate(update: TelegramBot.Update): void {
    this.bot?.processUpdate(update);
  }

  private target(chatId: string | number): string | number {
    return typeof chatId === 'number' ? chatId : (/^-?\d+$/.test(chatId) ? Number(chatId) : chatId);
  }

  private inlineKeyboard(buttons?: TgButton[][]): TelegramBot.InlineKeyboardMarkup | undefined {
    if (!buttons?.length) return undefined;
    return {
      inline_keyboard: buttons.map((row) => row.map((b) => ('url' in b
        ? { text: b.text, url: b.url.startsWith('http') ? b.url : `${config.telegram.crmUrl}${b.url}` }
        : { text: b.text, callback_data: b.callback }))),
    };
  }

  /**
   * HTML-сообщение. Длинный текст режется на части по ~4000 символов по границам
   * строк; кнопки — под последней частью. replyKeyboard — постоянные кнопки внизу
   * чата (только в личке). @returns message_id последней части или null.
   */
  async sendHtmlToChat(
    chatId: string | number,
    html: string,
    buttons?: TgButton[][],
    opts: { replyTo?: number; replyKeyboard?: string[][] } = {},
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

    const inline = this.inlineKeyboard(buttons);
    const replyMarkup = opts.replyKeyboard
      ? { keyboard: opts.replyKeyboard.map((row) => row.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true }
      : inline;
    let lastId: number | null = null;
    try {
      for (const [i, part] of parts.entries()) {
        const isLast = i === parts.length - 1;
        const sent = await this.bot.sendMessage(this.target(chatId), part, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(i === 0 && opts.replyTo ? { reply_to_message_id: opts.replyTo } : {}),
          ...(isLast && replyMarkup ? { reply_markup: replyMarkup as TelegramBot.InlineKeyboardMarkup } : {}),
        });
        lastId = sent.message_id;
      }
    } catch (err) {
      console.error(`[HOS bot] send failed chat_id=${chatId}:`, (err as Error).message);
    }
    return lastId;
  }

  /** Заменить текст и кнопки уже отправленного сообщения (пустой список — убрать кнопки). */
  async editHtmlMessage(chatId: string | number, messageId: number, html: string, buttons?: TgButton[][]): Promise<void> {
    await this.bot?.editMessageText(html, {
      chat_id: this.target(chatId),
      message_id: messageId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: this.inlineKeyboard(buttons) ?? { inline_keyboard: [] },
    }).catch((err) => console.warn(`[HOS bot] edit failed chat_id=${chatId}:`, (err as Error).message));
  }

  async clearButtons(chatId: string | number, messageId: number): Promise<void> {
    await this.bot?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: this.target(chatId), message_id: messageId }).catch(() => {});
  }

  async answerCallback(queryId: string, text?: string): Promise<void> {
    await this.bot?.answerCallbackQuery(queryId, text ? { text } : undefined).catch(() => {});
  }

  async sendTyping(chatId: string | number): Promise<void> {
    await this.bot?.sendChatAction(this.target(chatId), 'typing').catch(() => {});
  }

  async deleteChatMessage(chatId: string | number, messageId: number): Promise<void> {
    await this.bot?.deleteMessage(this.target(chatId), messageId).catch(() => {});
  }

  async downloadFile(fileId: string, dir: string): Promise<string> {
    if (!this.bot) throw new Error('HOS bot is not configured');
    return this.bot.downloadFile(fileId, dir);
  }
}

export const agentBot = new AgentBot();
