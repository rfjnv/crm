import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../lib/config';
import { telegramCustomerService } from './telegram.customer.service';
import { createTelegramBot, registerWebhook } from './telegram-transport';

class TelegramCustomerBotService {
  private bot: TelegramBot | null = null;
  private botUsername: string | null = null;

  constructor() {
    if (!config.telegram.clientBotToken) {
      console.log('Telegram client bot token not set, skipping client bot init');
      return;
    }

    this.bot = createTelegramBot(config.telegram.clientBotToken);
    this.setupHandlers();
    registerWebhook(this.bot, '/api/telegram/webhook/customer', 'Client bot');
    this.setupMenuButton();
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

  /** Кнопка меню рядом с полем ввода открывает мини-апп вместо списка команд. */
  private setupMenuButton() {
    const url = config.telegram.miniAppUrl;
    if (!this.bot || !url) return;

    // node-telegram-bot-api шлёт form-urlencoded и не сериализует menu_button сам — отсюда JSON.stringify.
    const menuButton = JSON.stringify({
      type: 'web_app',
      text: 'Магазин',
      web_app: { url },
    }) as unknown as TelegramBot.MenuButton;

    this.bot.setChatMenuButton({ menu_button: menuButton }).catch((err: Error) => {
      console.error('[Telegram client bot] setChatMenuButton failed:', err.message);
    });
  }

  getBotUsername(): string | null {
    return this.botUsername;
  }

  /** Нужен мини-аппе: подтверждение заказа и уведомление менеджера идут от клиентского бота. */
  getBot(): TelegramBot | null {
    return this.bot;
  }

  handleWebhookUpdate(update: TelegramBot.Update): void {
    this.bot?.processUpdate(update);
  }
}

export const telegramCustomerBotService = new TelegramCustomerBotService();
