import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../lib/config';
import { telegramCustomerService } from './telegram.customer.service';

class TelegramCustomerBotService {
  private bot: TelegramBot | null = null;
  private botUsername: string | null = null;

  constructor() {
    if (!config.telegram.clientBotToken) {
      console.log('Telegram client bot token not set, skipping client bot init');
      return;
    }

    this.bot = new TelegramBot(config.telegram.clientBotToken, { polling: true });
    this.setupHandlers();
    this.bot.getMe().then((me) => {
      this.botUsername = me.username || null;
      console.log(`Telegram client bot @${this.botUsername} started`);
    }).catch((err) => {
      console.error('Telegram client bot getMe failed:', err.message);
    });
  }

  private setupHandlers() {
    if (!this.bot) return;

    this.bot.onText(/^\/start$/, async (msg) => {
      await telegramCustomerService.handleStart(this.bot!, msg);
    });

    this.bot.on('callback_query', async (query) => {
      await telegramCustomerService.handleCallbackQuery(this.bot!, query);
    });

    this.bot.on('message', async (msg) => {
      await telegramCustomerService.handleMessage(this.bot!, msg);
    });
  }

  getBotUsername(): string | null {
    return this.botUsername;
  }
}

export const telegramCustomerBotService = new TelegramCustomerBotService();
