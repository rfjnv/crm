import type TelegramBot from 'node-telegram-bot-api';
import prisma from '../../lib/prisma';
import type { AuthUser } from '../../lib/scope';
import { AppError } from '../../lib/errors';
import { TG_ADMIN_APPROVE_PREFIX, TG_ADMIN_REJECT_PREFIX } from './telegram-admin.constants';

function escPlainForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Кнопки «Подтвердить / Отклонить» в личке (или группе): те же действия, что CRM (admin-approve / deal-reject).
 */
export function registerTelegramAdminCallbacks(bot: TelegramBot): void {
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data) return;

    const approve = data.startsWith(TG_ADMIN_APPROVE_PREFIX);
    const reject = data.startsWith(TG_ADMIN_REJECT_PREFIX);
    if (!approve && !reject) return;

    const dealId = approve ? data.slice(TG_ADMIN_APPROVE_PREFIX.length) : data.slice(TG_ADMIN_REJECT_PREFIX.length);
    if (!dealId || !isUuid(dealId)) {
      await bot.answerCallbackQuery(query.id, { text: 'Некорректные данные кнопки' });
      return;
    }

    const tgFromId = query.from?.id;
    if (tgFromId == null) {
      await bot.answerCallbackQuery(query.id, { text: 'Нет данных пользователя Telegram' });
      return;
    }

    const adminUser = await prisma.user.findFirst({
      where: {
        telegramChatId: String(tgFromId),
        role: { in: ['ADMIN', 'SUPER_ADMIN'] },
        isActive: true,
      },
      select: { id: true, role: true, permissions: true, fullName: true },
    });

    if (!adminUser) {
      await bot.answerCallbackQuery(query.id, {
        text: 'Нужна роль администратора в CRM и привязка Telegram (Настройки → Привязать Telegram).',
        show_alert: true,
      });
      return;
    }

    const authUser: AuthUser = {
      userId: adminUser.id,
      role: adminUser.role,
      permissions: adminUser.permissions,
    };

    const { dealsService } = await import('../deals/deals.service');

    try {
      if (approve) {
        await dealsService.approveAdmin(dealId, authUser);
        await bot.answerCallbackQuery(query.id, { text: 'Сделка одобрена' });
      } else {
        await dealsService.rejectDeal(dealId, 'Отклонено администратором (Telegram)', authUser);
        await bot.answerCallbackQuery(query.id, { text: 'Сделка возвращена в работу менеджеру' });
      }
    } catch (e) {
      const msg = e instanceof AppError ? e.message : (e as Error).message;
      await bot.answerCallbackQuery(query.id, { text: msg.slice(0, 180), show_alert: true });
      return;
    }

    const msg = query.message;
    if (msg && 'text' in msg && msg.text != null) {
      const statusBanner = approve
        ? `✅ <b>ОДОБРЕНО</b> — ${escPlainForHtml(adminUser.fullName)}`
        : `❌ <b>ОТКЛОНЕНО</b> — ${escPlainForHtml(adminUser.fullName)}`;
      const newText = `${statusBanner}\n\n${escPlainForHtml(msg.text)}`;
      try {
        await bot.editMessageText(newText, {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        });
      } catch {
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: msg.chat.id, message_id: msg.message_id },
          );
        } catch {
          /* ignore */
        }
      }
    }
  });
}
