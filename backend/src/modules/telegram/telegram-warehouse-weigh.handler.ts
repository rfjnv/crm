import type TelegramBot from 'node-telegram-bot-api';
import prisma from '../../lib/prisma';
import type { AuthUser } from '../../lib/scope';
import { AppError } from '../../lib/errors';
import { getFirstName } from '../../lib/name-utils';
import { TG_WAREHOUSE_WEIGH_PREFIX } from './telegram-admin.constants';
import { syncDealTelegramGroupMessages } from './telegram-deal-groups.service';

const WAREHOUSE_ROLES = ['WAREHOUSE', 'LOADER', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

async function resolveWarehouseUser(tgUserId: number): Promise<AuthUser & { fullName: string } | null> {
  const user = await prisma.user.findFirst({
    where: {
      telegramChatId: String(tgUserId),
      role: { in: [...WAREHOUSE_ROLES] },
      isActive: true,
    },
    select: { id: true, role: true, permissions: true, fullName: true },
  });
  if (!user) return null;
  return { userId: user.id, role: user.role, permissions: user.permissions, fullName: user.fullName };
}

/** Число из ответа пользователя: «12.5», «12,5», «/ves 12.5» — всё сводим к точке и берём первое число. */
function parseWeightReply(text: string): number | null {
  const m = text.trim().replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Складской бот: кнопка «⚖️ Ввести вес» под позицией → force-reply в чате → парсим число
 * из ответа и сохраняем через submitWarehouseResponseForItem (deals.service), запоминая,
 * кто из Telegram ввёл вес (DealItem.confirmedBy/confirmedAt — то же поле, что у ответа
 * склада из CRM). Один товар — одна позиция, без завязки на общий «ответить сразу по всем».
 */
export function registerTelegramWarehouseWeighHandlers(bot: TelegramBot): void {
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data || !data.startsWith(TG_WAREHOUSE_WEIGH_PREFIX)) return;

    const dealItemId = data.slice(TG_WAREHOUSE_WEIGH_PREFIX.length);
    if (!dealItemId || !isUuid(dealItemId)) {
      await bot.answerCallbackQuery(query.id, { text: 'Некорректные данные кнопки' });
      return;
    }

    const chat = query.message?.chat;
    const fromId = query.from?.id;
    if (!chat || fromId == null) {
      await bot.answerCallbackQuery(query.id, { text: 'Нет данных чата/пользователя' });
      return;
    }

    const warehouseUser = await resolveWarehouseUser(fromId);
    if (!warehouseUser) {
      await bot.answerCallbackQuery(query.id, {
        text: 'Нужна роль склада в CRM и привязка Telegram (Настройки → Привязать Telegram).',
        show_alert: true,
      });
      return;
    }

    const item = await prisma.dealItem.findUnique({
      where: { id: dealItemId },
      select: {
        id: true,
        dealId: true,
        requestedQty: true,
        product: { select: { name: true } },
      },
    });
    if (!item) {
      await bot.answerCallbackQuery(query.id, { text: 'Позиция не найдена (сделка могла измениться)' });
      return;
    }
    const qtyAlready = item.requestedQty != null && Number(item.requestedQty) > 0;
    if (qtyAlready) {
      await bot.answerCallbackQuery(query.id, { text: 'Вес по этой позиции уже внесён' });
      return;
    }

    const chatIdStr = String(chat.id);
    const promptText = `⚖️ <b>${esc(getFirstName(warehouseUser.fullName))}</b>, ответьте на это сообщение весом (кг) для «${esc(item.product.name)}»`;

    try {
      const sent = await bot.sendMessage(chat.id, promptText, {
        parse_mode: 'HTML',
        reply_to_message_id: query.message?.message_id,
        reply_markup: { force_reply: true, selective: true },
      });

      await prisma.telegramWeighPrompt.upsert({
        where: { chatId_telegramUserId: { chatId: chatIdStr, telegramUserId: String(fromId) } },
        create: {
          chatId: chatIdStr,
          telegramUserId: String(fromId),
          dealId: item.dealId,
          dealItemId: item.id,
          promptMessageId: sent.message_id,
        },
        update: {
          dealId: item.dealId,
          dealItemId: item.id,
          promptMessageId: sent.message_id,
          createdAt: new Date(),
        },
      });

      await bot.answerCallbackQuery(query.id, { text: 'Жду вес числом в кг' });
    } catch (err) {
      console.error('[Telegram warehouse weigh] prompt send failed:', (err as Error).message);
      await bot.answerCallbackQuery(query.id, { text: 'Не удалось отправить запрос веса, попробуйте ещё раз' });
    }
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.from == null) return;
    if (msg.text.startsWith('/start') || msg.text.startsWith('/unlink')) return;

    const chatIdStr = String(msg.chat.id);
    const fromIdStr = String(msg.from.id);

    const prompt = await prisma.telegramWeighPrompt.findUnique({
      where: { chatId_telegramUserId: { chatId: chatIdStr, telegramUserId: fromIdStr } },
    });
    if (!prompt) return;
    // Ждём именно ответ на наше сообщение — иначе не мешаем обычной переписке в группе.
    if (msg.reply_to_message?.message_id !== prompt.promptMessageId) return;

    const qty = parseWeightReply(msg.text);
    if (qty == null) {
      await bot.sendMessage(msg.chat.id, '⚠️ Не понял число. Введите вес в кг, например: 12.5', {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    const warehouseUser = await resolveWarehouseUser(msg.from.id);
    if (!warehouseUser) {
      await bot.sendMessage(msg.chat.id, '⚠️ Нужна роль склада в CRM и привязка Telegram.', {
        reply_to_message_id: msg.message_id,
      });
      await prisma.telegramWeighPrompt.delete({ where: { chatId_telegramUserId: { chatId: chatIdStr, telegramUserId: fromIdStr } } }).catch(() => {});
      return;
    }

    try {
      const { dealsService } = await import('../deals/deals.service');
      const result = await dealsService.submitWarehouseResponseForItem(
        prompt.dealId,
        prompt.dealItemId,
        { requestedQty: qty },
        warehouseUser,
      );

      await prisma.telegramWeighPrompt.delete({
        where: { chatId_telegramUserId: { chatId: chatIdStr, telegramUserId: fromIdStr } },
      }).catch(() => {});

      const doneNote = result.allDone ? '\n\n✅ Все позиции взвешены — сделка передана дальше.' : '';
      await bot.sendMessage(
        msg.chat.id,
        `✅ Записано: «${esc(result.itemName)}» — <b>${esc(String(result.qty))}</b> кг (${esc(getFirstName(warehouseUser.fullName))})${doneNote}`,
        { parse_mode: 'HTML', reply_to_message_id: msg.message_id },
      );

      if (!result.allDone) {
        void syncDealTelegramGroupMessages(prompt.dealId).catch((err) => {
          console.error('[Telegram warehouse weigh] syncDealTelegramGroupMessages:', err);
        });
      }
    } catch (err) {
      const text = err instanceof AppError ? err.message : (err as Error).message;
      await bot.sendMessage(msg.chat.id, `⚠️ ${text}`, { reply_to_message_id: msg.message_id });
      await prisma.telegramWeighPrompt.delete({
        where: { chatId_telegramUserId: { chatId: chatIdStr, telegramUserId: fromIdStr } },
      }).catch(() => {});
    }
  });
}
