import TelegramBot from 'node-telegram-bot-api';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import type { PushPayload } from '../push/push.service';

const LINK_SECRET = config.jwt.accessSecret + '_tg';

const SEVERITY_EMOJI: Record<string, string> = {
  URGENT: '\u{1F6A8}',
  WARNING: '\u26A0\uFE0F',
  INFO: '\u2139\uFE0F',
};

class TelegramService {
  private bot: TelegramBot | null = null;
  private botUsername: string | null = null;

  constructor() {
    if (!config.telegram.botToken) {
      console.log('Telegram bot token not set, skipping bot init');
      return;
    }
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    this.setupHandlers();
    this.bot.getMe().then((me) => {
      this.botUsername = me.username || null;
      console.log(`Telegram bot @${this.botUsername} started`);
    }).catch((err) => {
      console.error('Telegram bot getMe failed:', err.message);
    });
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
          `\u2705 \u0423\u0441\u043F\u0435\u0448\u043D\u043E \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D\u043E!\n\n\u0412\u044B \u0431\u0443\u0434\u0435\u0442\u0435 \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F CRM \u043A\u0430\u043A <b>${user.fullName}</b>.\n\n\u0414\u043B\u044F \u043E\u0442\u0432\u044F\u0437\u043A\u0438 \u043D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 /unlink`,
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
  }

  private formatMessage(payload: PushPayload): string {
    const emoji = SEVERITY_EMOJI[payload.severity || 'INFO'] || SEVERITY_EMOJI.INFO;
    let text = `${emoji} <b>${this.escapeHtml(payload.title)}</b>\n\n${this.escapeHtml(payload.body)}`;
    return text;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
}

export const telegramService = new TelegramService();
