import type TelegramBot from 'node-telegram-bot-api';
import fs from 'fs/promises';
import path from 'path';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { agentBot, type TgButton } from './rop-agent.bot';
import { buildDigest, tashkentYesterday, type DigestData } from './rop-agent.digest';
import { assignPlan, discardPlan } from './rop-agent.plans';
import { activeMemories } from './rop-agent.memory';
import { sendOpenAlerts } from './rop-agent.alerts';
import { transcribeVoiceNote } from './rop-agent.voice';
import {
  askInChat,
  createChat,
  getLastAssistantMessage,
  getTelegramChat,
  getTurnStatus,
  waitForTurn,
} from './rop-agent.service';

/**
 * РОП-агент в Telegram — отдельный бот (HOS_BOT_TOKEN, см. rop-agent.bot), не CRM-бот.
 * Писать могут только Telegram ID из HOS_ALLOWED_IDS: разговор с агентом в личке и
 * в группе, голосовые, быстрые кнопки; сводка и сигналы уходят в группу HOS_GROUP_ID.
 */

// ─── Форматирование ─────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Коротко для Telegram: 48,2 млн · 1,02 млрд · 850 тыс. */
export function shortMoney(v: number): string {
  const abs = Math.abs(v);
  const fmt = (n: number, digits: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
  if (abs >= 1e9) return `${fmt(v / 1e9, 2)} млрд`;
  if (abs >= 1e6) return `${fmt(v / 1e6, 1)} млн`;
  if (abs >= 1e3) return `${fmt(v / 1e3, 0)} тыс.`;
  return fmt(v, 0);
}

function delta(now: number, before: number): string {
  if (!before) return '';
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? '±0%' : `${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}%`;
}

/**
 * Ответ агента (markdown) → HTML, который понимает Telegram: жирный, код, ссылки,
 * списки. Таблиц в Telegram нет — таблица уходит моноширинным блоком.
 */
export function markdownToTelegramHtml(md: string): string {
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

  const out: string[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // Таблица: собираем подряд идущие строки, выравниваем колонки.
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim().replace(/\*\*/g, ''));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      const widths = rows[0]?.map((_, col) => Math.min(24, Math.max(...rows.map((r) => (r[col] ?? '').length)))) ?? [];
      const text = rows
        .map((r) => r.map((c, col) => (c.length > 24 ? `${c.slice(0, 23)}…` : c).padEnd(widths[col] ?? 0)).join('  ').trimEnd())
        .join('\n');
      out.push(`<pre>${esc(text)}</pre>`);
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { out.push(`<b>${inline(heading[1])}</b>`); continue; }
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) { out.push(`${bullet[1]}• ${inline(bullet[2])}`); continue; }
    if (/^\s*-{3,}\s*$/.test(line)) { out.push(''); continue; }
    out.push(inline(line));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const VERDICT_MARK: Record<string, string> = { ok: '✅', in_progress: '⏳', behind: '⚠️', no_touch: '❗' };

export function digestToTelegramHtml(d: DigestData, commentary: string | null): string {
  const date = new Date(`${d.date}T00:00:00Z`);
  const title = `${d.date.slice(8, 10)}.${d.date.slice(5, 7)} (${WEEKDAYS[date.getUTCDay()]})`;
  const r = d.revenue;
  const lines: string[] = [
    `<b>Сводка за ${title}</b>`,
    '',
    `💰 Выручка: <b>${shortMoney(r.day)}</b> ${[delta(r.day, r.prevDay) && `${delta(r.day, r.prevDay)} к пред. дню`, delta(r.day, r.sameWeekdayLastWeek) && `${delta(r.day, r.sameWeekdayLastWeek)} к прошлой неделе`].filter(Boolean).join(', ')}`,
    `📅 С начала месяца: <b>${shortMoney(r.mtd)}</b>${r.prevMtd ? ` ${delta(r.mtd, r.prevMtd)} к тому же периоду прошлого месяца` : ''}`,
    `🤝 Сделок закрыто: ${d.deals.closedDay}, новых: ${d.deals.newDay}`,
    `💳 Долги: ${shortMoney(d.debts.total)}, просрочено <b>${shortMoney(d.debts.overdue)}</b> (${d.debts.overdueDeals} сд.)`,
    `👥 Пропали: ${d.clients.overdue} постоянных клиентов · пора покупать: ${d.clients.dueSoon}`,
  ];
  if (d.slowStock.count) lines.push(`📦 Залежалось: ${d.slowStock.count} позиций на ${shortMoney(d.slowStock.frozen)} по закупке`);
  const top = d.managers.filter((m) => m.revenueMtd > 0).slice(0, 5);
  if (top.length) {
    lines.push('', '<b>Менеджеры (месяц / вчера)</b>');
    for (const m of top) lines.push(`${esc(m.name)}: ${shortMoney(m.revenueMtd)} / ${shortMoney(m.revenueDay)}`);
  }
  if (d.plans.length) {
    lines.push('', '<b>Розданные задачи</b>');
    for (const p of d.plans.slice(0, 8)) {
      lines.push(`${VERDICT_MARK[p.verdict] ?? '•'} ${esc(p.manager)}: ${p.touched}/${p.clients}${p.overdue ? ', срок прошёл' : ''}`);
    }
  }
  if (commentary) lines.push('', '<b>На что обратить внимание</b>', markdownToTelegramHtml(commentary));
  return lines.join('\n');
}

// ─── Кто пишет ──────────────────────────────────────────────────────────────

export type AgentUser = { id: string; fullName: string };

/**
 * Сотрудник CRM по Telegram ID — только из HOS_ALLOWED_IDS. Кто есть кто: сначала
 * HOS_USERS («telegramId=логин»), иначе привязанный в CRM Telegram (его chat id в
 * личке и есть Telegram ID). null — нет доступа или сотрудник не найден.
 */
export async function agentUserByTelegramId(telegramId: number | string | undefined): Promise<AgentUser | null> {
  if (!agentBot.isAllowed(telegramId)) return null;
  const login = config.hos.users[String(telegramId)];
  const user = await prisma.user.findFirst({
    where: login ? { login } : { telegramChatId: String(telegramId) },
    select: { id: true, fullName: true, isActive: true },
  });
  return user?.isActive ? { id: user.id, fullName: user.fullName } : null;
}

const NOT_LINKED = (telegramId: number | string | undefined) => [
  '⚠️ Не нашёл вас в CRM.',
  `Ваш Telegram ID: <code>${telegramId}</code>.`,
  'Привяжите Telegram в CRM («Уведомления → Привязать Telegram») или попросите администратора добавить в HOS_USERS строку «ID=логин».',
].join('\n');

/** Куда слать сводку и сигналы: в группу, а без неё — в личку каждому разрешённому. */
export function broadcastTargets(): string[] {
  return agentBot.groupId ? [agentBot.groupId] : [...config.hos.allowedIds];
}

/** Telegram ID сотрудника CRM — для «Прислать мне» со страницы. */
async function telegramIdOf(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { login: true, telegramChatId: true } });
  if (!user) return null;
  const mapped = Object.entries(config.hos.users).find(([, login]) => login === user.login)?.[0];
  const id = mapped ?? user.telegramChatId;
  return id && agentBot.isAllowed(id) ? id : null;
}

// ─── Сводка ─────────────────────────────────────────────────────────────────

async function digestFor(date: string) {
  return (await prisma.ropDailyDigest.findUnique({ where: { date } })) ?? buildDigest(date);
}

function digestMessage(digest: { date: string; data: unknown; commentary: string | null }) {
  return {
    html: digestToTelegramHtml(digest.data as DigestData, digest.commentary),
    buttons: [[{ text: '📊 Открыть сводку в CRM', url: `/rop-agent/digest?date=${digest.date}` }]] as TgButton[][],
  };
}

/** Утренняя рассылка: в группу (или разрешённым в личку), отмечает sentAt. */
export async function sendDigestToRecipients(date: string): Promise<number> {
  const digest = await digestFor(date);
  const { html, buttons } = digestMessage(digest);
  let sent = 0;
  for (const target of broadcastTargets()) {
    if (await agentBot.sendHtmlToChat(target, html, buttons)) sent++;
  }
  await prisma.ropDailyDigest.update({ where: { date }, data: { sentAt: new Date() } });
  return sent;
}

/** «Прислать мне в Telegram» со страницы сводки — в личку HOS-бота. */
export async function sendDigestToUser(date: string, userId: string): Promise<void> {
  if (!agentBot.enabled) throw new AppError(503, 'Бот РОП-агента не настроен (HOS_BOT_TOKEN)');
  const telegramId = await telegramIdOf(userId);
  if (!telegramId) {
    throw new AppError(400, 'Ваш Telegram не подключён к боту РОП-агента: нужен в HOS_ALLOWED_IDS и привязан в CRM (или в HOS_USERS).');
  }
  const digest = await prisma.ropDailyDigest.findUnique({ where: { date } });
  if (!digest) throw new AppError(404, 'Сводки за этот день нет');
  const { html, buttons } = digestMessage(digest);
  const ok = await agentBot.sendHtmlToChat(telegramId, html, buttons);
  if (!ok) throw new AppError(502, 'Telegram не принял сообщение. Откройте бота и нажмите «Start».');
}

// ─── Разговор ───────────────────────────────────────────────────────────────

/** Быстрые кнопки внизу лички: текст кнопки → действие. */
const QUICK = {
  digest: '📊 Сводка',
  alerts: '🔔 Сигналы',
  managers: '👥 Менеджеры',
  debts: '💰 Долги',
  lapsed: '📉 Пропавшие клиенты',
  stock: '📦 Залежалое',
  memory: '🧠 Память',
  fresh: '🆕 Новый разговор',
} as const;

const QUICK_KEYBOARD: string[][] = [
  [QUICK.digest, QUICK.alerts],
  [QUICK.managers, QUICK.debts],
  [QUICK.lapsed, QUICK.stock],
  [QUICK.memory, QUICK.fresh],
];

/** Кнопки-вопросы: агенту уходит готовое задание. */
const QUICK_QUESTIONS: Record<string, string> = {
  [QUICK.managers]: 'Как работают менеджеры в этом месяце: выручка, сделки, розданные задачи. Кто отстаёт и что с этим сделать? Коротко.',
  [QUICK.debts]: 'Кто сейчас должен больше всего и с какой просрочкой? Что делать с топ-5 должниками? Коротко.',
  [QUICK.lapsed]: 'Какие ценные постоянные клиенты пропали? Топ-10: кто ведёт, что брали, что предложить.',
  [QUICK.stock]: 'Что залежалось на складе дольше 60 дней, сколько денег заморожено и кому это предложить?',
};

/** Кнопки «продолжить» под ответом без плана: частые следующие шаги одним нажатием. */
const FOLLOW_UPS: Record<string, string> = {
  d: 'Подробнее: распиши по каждому пункту с цифрами и именами.',
  t: 'Подготовь по этому план задач менеджерам.',
};

const HELP = [
  '<b>РОП-агент</b>',
  'Пишите задание обычным текстом или голосовым — агент изучит данные CRM и ответит. Внизу — быстрые кнопки.',
  '',
  '🎧 Запись звонка менеджера пришлите файлом — агент расшифрует и разберёт. Подпишите файл: «Дилноза, Print House».',
  '👥 В группе агент отвечает, если упомянуть его или ответить на его сообщение. Туда же приходят сводка в 9:00 и сигналы.',
  '',
  '/menu — быстрые кнопки',
  '/digest — сводка за вчера',
  '/alerts — сигналы, ждущие решения',
  '/memory — что помнит агент',
  '/new — начать новый разговор',
  '',
  'Планы задач агент готовит черновиком — раздать их можно кнопкой под ответом или в CRM.',
].join('\n');

type ChatContext = { telegramChatId: number; channel: 'telegram' | 'telegram_group'; replyTo?: number };

/** Как часто обновлять статус: чаще — Telegram начнёт ограничивать правки. */
const PROGRESS_EVERY_MS = 5000;
const SLOW_AFTER_SEC = 180;

/**
 * Статус, пока агент думает: секунды и что он уже посмотрел. Секунды растут при
 * каждом обновлении — если счётчик встал, процесс на сервере прервался.
 */
function progressHtml(steps: string[], sec: number): string {
  const lines = [`⏳ <b>Агент работает</b> · ${sec} с`];
  const shown = steps.slice(-6);
  if (steps.length > shown.length) lines.push(`<i>…ещё ${steps.length - shown.length} шаг(ов)</i>`);
  lines.push(...shown.map((s) => `✓ ${esc(s)}`));
  if (!steps.length) lines.push('<i>Читаю задание…</i>');
  if (sec >= SLOW_AFTER_SEC) lines.push('', '<i>Сложный вопрос — ещё работаю.</i>');
  lines.push('', '<i>Если секунды перестали расти — сервер перезапустился, повторите вопрос.</i>');
  return lines.join('\n');
}

/** Ответ агента может занять минуты: держим «печатает…» и ждём окончания. */
export async function askAgentFromTelegram(ctx: ChatContext, userId: string, question: string): Promise<void> {
  const { telegramChatId: chatId, replyTo } = ctx;
  const chat = await getTelegramChat(userId, ctx.channel);
  try {
    await askInChat(chat.id, userId, question);
  } catch (err) {
    await agentBot.sendHtmlToChat(chatId, `⚠️ ${esc((err as Error).message)}`, undefined, { replyTo });
    return;
  }
  const startedAt = Date.now();
  const waitingId = await agentBot.sendHtmlToChat(chatId, progressHtml([], 0), undefined, { replyTo });
  await agentBot.sendTyping(chatId);
  const progress = setInterval(() => {
    agentBot.sendTyping(chatId);
    if (!waitingId) return;
    const sec = Math.round((Date.now() - startedAt) / 1000);
    agentBot.editHtmlMessage(chatId, waitingId, progressHtml(getTurnStatus(chat.id).steps, sec));
  }, PROGRESS_EVERY_MS);
  try {
    await waitForTurn(chat.id);
  } finally {
    clearInterval(progress);
    if (waitingId) await agentBot.deleteChatMessage(chatId, waitingId);
  }

  const reply = await getLastAssistantMessage(chat.id);
  if (!reply) return;
  const planIds = ((reply.toolCalls as { planId?: string }[] | null) ?? []).map((t) => t.planId).filter((id): id is string => !!id);
  const html = reply.isError ? `⚠️ ${esc(reply.text)}` : markdownToTelegramHtml(reply.text);
  const plans = planIds.length
    ? await prisma.ropTaskPlan.findMany({ where: { id: { in: planIds }, status: 'DRAFT' }, select: { id: true, title: true, items: true } })
    : [];
  const buttons: TgButton[][] = plans.map((p) => {
    const tasks = (p.items as unknown as unknown[]).length;
    return [
      { text: `✅ Раздать (${tasks})`, callback: `rop:p:${p.id}:y` },
      { text: '✖ Отклонить', callback: `rop:p:${p.id}:n` },
    ];
  });
  if (!plans.length && !reply.isError) {
    buttons.push([
      { text: '🔎 Подробнее', callback: 'rop:f:d' },
      { text: '📝 Подготовь задачи', callback: 'rop:f:t' },
    ]);
  }
  buttons.push([{ text: plans.length ? '📝 Посмотреть план в CRM' : 'Открыть разговор в CRM', url: `/rop-agent?chat=${chat.id}` }]);
  await agentBot.sendHtmlToChat(chatId, html || '…', buttons, { replyTo });
}

const contextOf = (chat: TelegramBot.Chat, replyTo?: number): ChatContext => ({
  telegramChatId: chat.id,
  channel: chat.type === 'private' ? 'telegram' : 'telegram_group',
  replyTo: chat.type === 'private' ? undefined : replyTo,
});

/**
 * «Раздать» / «Отклонить» под ответом агента. Нажать может любой из разрешённых —
 * в группе план мог попросить другой; раздаётся от имени того, кто его заказал.
 */
async function onPlanButton(query: TelegramBot.CallbackQuery): Promise<void> {
  const [, , planId, action] = (query.data ?? '').split(':');
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const user = await agentUserByTelegramId(query.from.id);
  const plan = planId ? await prisma.ropTaskPlan.findUnique({ where: { id: planId }, select: { chat: { select: { userId: true } } } }) : null;
  if (!user || !plan || chatId == null || messageId == null) {
    await agentBot.answerCallback(query.id, 'Нет доступа');
    return;
  }
  try {
    if (action === 'y') {
      const r = await assignPlan(planId, plan.chat.userId);
      await agentBot.answerCallback(query.id, `Роздано задач: ${r.createdTasks}`);
      const warn = r.warnings.length ? `\n⚠️ ${esc(r.warnings.join('; '))}` : '';
      await agentBot.sendHtmlToChat(chatId, `✅ ${esc(user.fullName)}: план «${esc(r.plan.title)}» роздан, задач ${r.createdTasks}.${warn}`, [[{ text: 'Открыть задачи', url: '/tasks' }]]);
    } else {
      const p = await discardPlan(planId, plan.chat.userId);
      await agentBot.answerCallback(query.id, 'План отклонён');
      await agentBot.sendHtmlToChat(chatId, `✖ ${esc(user.fullName)}: план «${esc(p.title)}» отклонён.`);
    }
  } catch (err) {
    // План уже роздан/отклонён (в CRM или вторым нажатием) — просто объясняем.
    await agentBot.answerCallback(query.id, (err as Error).message.slice(0, 190));
  }
  await agentBot.clearButtons(chatId, messageId);
}

/** «Подробнее» / «Подготовь задачи» под ответом — следующий шаг в том же разговоре. */
async function onFollowUp(query: TelegramBot.CallbackQuery): Promise<void> {
  const kind = (query.data ?? '').split(':')[2];
  const question = FOLLOW_UPS[kind];
  const message = query.message;
  const user = await agentUserByTelegramId(query.from.id);
  if (!user || !question || !message) {
    await agentBot.answerCallback(query.id, 'Нет доступа');
    return;
  }
  await agentBot.answerCallback(query.id, 'Спрашиваю агента');
  await agentBot.clearButtons(message.chat.id, message.message_id);
  await askAgentFromTelegram(contextOf(message.chat, message.message_id), user.id, question);
}

async function sendMemory(chatId: number): Promise<void> {
  const memories = await activeMemories();
  const text = memories.length
    ? ['<b>🧠 Что помнит агент</b>', ...memories.map((m) => `• ${esc(m.content)}${m.expiresAt ? ` <i>(до ${m.expiresAt.toISOString().slice(0, 10).split('-').reverse().join('.')})</i>` : ''}`)].join('\n')
    : '🧠 Память пуста. Скажите агенту «запомни: …», и он будет учитывать это везде.';
  await agentBot.sendHtmlToChat(chatId, text, [[{ text: 'Изменить в CRM', url: '/rop-agent' }]]);
}

/** Команды и быстрые кнопки. true — обработано, дальше агенту не передаём. */
async function handleCommand(msg: TelegramBot.Message, user: AgentUser, text: string): Promise<boolean> {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const command = text.startsWith('/') ? text.split(/\s|@/)[0].toLowerCase() : null;

  if (command === '/start' || command === '/help' || command === '/menu') {
    await agentBot.sendHtmlToChat(chatId, HELP, undefined, isPrivate ? { replyKeyboard: QUICK_KEYBOARD } : { replyTo: msg.message_id });
    return true;
  }
  if (command === '/new' || text === QUICK.fresh) {
    await createChat(user.id, isPrivate ? 'telegram' : 'telegram_group');
    await agentBot.sendHtmlToChat(chatId, '🆕 Новый разговор. Какое задание?');
    return true;
  }
  if (command === '/digest' || text === QUICK.digest) {
    await agentBot.sendTyping(chatId);
    const { html, buttons } = digestMessage(await digestFor(tashkentYesterday()));
    await agentBot.sendHtmlToChat(chatId, html, buttons);
    return true;
  }
  if (command === '/alerts' || text === QUICK.alerts) {
    const n = await sendOpenAlerts(chatId);
    if (!n) await agentBot.sendHtmlToChat(chatId, '🔔 Сигналов, ждущих решения, нет.');
    return true;
  }
  if (command === '/memory' || text === QUICK.memory) {
    await sendMemory(chatId);
    return true;
  }
  if (QUICK_QUESTIONS[text]) {
    await askAgentFromTelegram(contextOf(msg.chat, msg.message_id), user.id, QUICK_QUESTIONS[text]);
    return true;
  }
  if (command) {
    await agentBot.sendHtmlToChat(chatId, HELP, undefined, isPrivate ? { replyKeyboard: QUICK_KEYBOARD } : undefined);
    return true;
  }
  return false;
}

async function onPrivateText(msg: TelegramBot.Message): Promise<void> {
  const user = await agentUserByTelegramId(msg.from?.id);
  if (!user) {
    await agentBot.sendHtmlToChat(msg.chat.id, NOT_LINKED(msg.from?.id));
    return;
  }
  const text = (msg.text ?? '').trim();
  if (await handleCommand(msg, user, text)) return;
  await askAgentFromTelegram(contextOf(msg.chat), user.id, text);
}

/** В группе — упоминание или ответ боту; отвечаем реплаем, разговор у каждого свой. */
async function onGroupText(msg: TelegramBot.Message): Promise<void> {
  const user = await agentUserByTelegramId(msg.from?.id);
  if (!user) {
    await agentBot.sendHtmlToChat(msg.chat.id, NOT_LINKED(msg.from?.id), undefined, { replyTo: msg.message_id });
    return;
  }
  const text = agentBot.stripMention(msg.text ?? '');
  if (!text) {
    await agentBot.sendHtmlToChat(msg.chat.id, 'Слушаю. Какое задание?', undefined, { replyTo: msg.message_id });
    return;
  }
  if (await handleCommand(msg, user, text)) return;
  await askAgentFromTelegram(contextOf(msg.chat, msg.message_id), user.id, text);
}

/** Длиннее — это уже не задание, а лекция; и распознавание дорожает. */
const MAX_VOICE_SEC = 5 * 60;

/**
 * Голосовое: расшифровываем, показываем, что услышали (чтобы было видно ошибку
 * распознавания), и отдаём агенту как обычный текст.
 */
async function onPrivateVoice(msg: TelegramBot.Message): Promise<void> {
  const user = await agentUserByTelegramId(msg.from?.id);
  if (!user) {
    await agentBot.sendHtmlToChat(msg.chat.id, NOT_LINKED(msg.from?.id));
    return;
  }
  const media = msg.voice;
  if (!media) return;
  if ((media.duration ?? 0) > MAX_VOICE_SEC) {
    await agentBot.sendHtmlToChat(msg.chat.id, `⚠️ Голосовое длиннее ${MAX_VOICE_SEC / 60} минут — разбейте на части или напишите текстом.`);
    return;
  }

  const statusId = await agentBot.sendHtmlToChat(msg.chat.id, '🎙 Слушаю…');
  await agentBot.sendTyping(msg.chat.id);
  const dir = path.resolve(config.uploads.dir, 'tg-voice');
  let file: string | null = null;
  let text: string;
  try {
    await fs.mkdir(dir, { recursive: true });
    file = await agentBot.downloadFile(media.file_id, dir);
    text = await transcribeVoiceNote(file);
  } catch (err) {
    const reason = err instanceof AppError ? err.message : 'Не удалось распознать голосовое. Попробуйте ещё раз или напишите текстом.';
    if (!(err instanceof AppError)) console.error('[rop-voice] failed:', (err as Error).message);
    if (statusId) await agentBot.editHtmlMessage(msg.chat.id, statusId, `⚠️ ${esc(reason)}`);
    return;
  } finally {
    if (file) await fs.unlink(file).catch(() => {});
  }

  if (statusId) await agentBot.editHtmlMessage(msg.chat.id, statusId, `🎙 <i>${esc(text)}</i>`);
  await askAgentFromTelegram(contextOf(msg.chat), user.id, `🎙 ${text}`);
}

agentBot.onPrivateText(onPrivateText);
agentBot.onGroupText(onGroupText);
agentBot.onPrivateVoice(onPrivateVoice);
agentBot.onCallback('rop:p:', onPlanButton);
agentBot.onCallback('rop:f:', onFollowUp);
