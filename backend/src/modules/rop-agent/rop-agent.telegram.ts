import type TelegramBot from 'node-telegram-bot-api';
import fs from 'fs/promises';
import path from 'path';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { PERMISSIONS } from '../../lib/permissions';
import { telegramService, type TgButton } from '../telegram/telegram.service';
import { buildDigest, tashkentYesterday, type DigestData } from './rop-agent.digest';
import { assignPlan, discardPlan } from './rop-agent.plans';
import { transcribeVoiceNote } from './rop-agent.voice';
import {
  askInChat,
  createChat,
  getLastAssistantMessage,
  getTelegramChat,
  waitForTurn,
} from './rop-agent.service';

/**
 * РОП-агент в Telegram — через существующий CRM-бот, только для тех, у кого есть
 * право use_rop_agent (или SUPER_ADMIN) и полный доступ к деньгам: ежедневная сводка
 * и разговор с агентом в личке. Остальным бот на обычный текст не отвечает, как и раньше.
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

// ─── Кому можно ─────────────────────────────────────────────────────────────

type AgentUser = { id: string; fullName: string; telegramChatId: string };

function hasAgentAccess(u: { role: string; permissions: string[]; moneyAccess: string; isActive: boolean }): boolean {
  if (!u.isActive || u.moneyAccess !== 'FULL') return false;
  return u.role === 'SUPER_ADMIN' || u.permissions.includes(PERMISSIONS.USE_ROP_AGENT);
}

/** Сотрудник CRM с доступом к агенту по id личного чата в Telegram, иначе null. */
export async function agentUserByChat(chatId: number | string): Promise<{ id: string; fullName: string } | null> {
  const user = await prisma.user.findFirst({
    where: { telegramChatId: String(chatId) },
    select: { id: true, fullName: true, role: true, permissions: true, moneyAccess: true, isActive: true },
  });
  return user && hasAgentAccess(user) ? { id: user.id, fullName: user.fullName } : null;
}

/**
 * Получатели ежедневной сводки — только с правом use_rop_agent, выданным явно:
 * суперадминов в компании может быть больше, чем тех, кому нужна сводка.
 */
export async function digestRecipients(): Promise<AgentUser[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, moneyAccess: 'FULL', telegramChatId: { not: null }, permissions: { has: PERMISSIONS.USE_ROP_AGENT } },
    select: { id: true, fullName: true, telegramChatId: true },
  });
  return users as AgentUser[];
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

/** Утренняя рассылка: всем получателям, отмечает sentAt. Возвращает, скольким ушло. */
export async function sendDigestToRecipients(date: string): Promise<number> {
  const digest = await digestFor(date);
  const recipients = await digestRecipients();
  const { html, buttons } = digestMessage(digest);
  let sent = 0;
  for (const u of recipients) {
    if (await telegramService.sendHtmlToChat(u.telegramChatId, html, buttons)) sent++;
  }
  await prisma.ropDailyDigest.update({ where: { date }, data: { sentAt: new Date() } });
  return sent;
}

/** «Прислать мне» со страницы сводки. */
export async function sendDigestToUser(date: string, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
  if (!user?.telegramChatId) {
    throw new AppError(400, 'Telegram не привязан. Привяжите его в CRM: Уведомления → «Привязать Telegram».');
  }
  const digest = await prisma.ropDailyDigest.findUnique({ where: { date } });
  if (!digest) throw new AppError(404, 'Сводки за этот день нет');
  const { html, buttons } = digestMessage(digest);
  const ok = await telegramService.sendHtmlToChat(user.telegramChatId, html, buttons);
  if (!ok) throw new AppError(502, 'Telegram не принял сообщение. Проверьте, что бот не заблокирован.');
}

// ─── Разговор в личке ───────────────────────────────────────────────────────

const HELP = [
  '<b>РОП-агент</b>',
  'Пишите задание или вопрос обычным текстом или голосовым — агент изучит данные CRM и ответит.',
  '',
  '/new — начать новый разговор',
  '/digest — сводка за вчера',
  '/help — эта подсказка',
  '',
  'Планы задач агент готовит черновиком — раздать их можно кнопкой под ответом или в CRM.',
].join('\n');

/** Ответ агента может занять минуты: держим «печатает…» и ждём окончания. */
async function answer(chatId: number, userId: string, question: string): Promise<void> {
  const chat = await getTelegramChat(userId);
  try {
    await askInChat(chat.id, userId, question);
  } catch (err) {
    await telegramService.sendHtmlToChat(chatId, `⚠️ ${esc((err as Error).message)}`);
    return;
  }
  const waitingId = await telegramService.sendHtmlToChat(chatId, '⏳ Изучаю данные…');
  await telegramService.sendTyping(chatId);
  const typing = setInterval(() => { telegramService.sendTyping(chatId); }, 5000);
  try {
    await waitForTurn(chat.id);
  } finally {
    clearInterval(typing);
    if (waitingId) await telegramService.deleteChatMessage(chatId, waitingId);
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
  buttons.push([{ text: plans.length ? '📝 Посмотреть план в CRM' : 'Открыть разговор в CRM', url: `/rop-agent?chat=${chat.id}` }]);
  await telegramService.sendHtmlToChat(chatId, html || '…', buttons);
}

/**
 * «Раздать» / «Отклонить» под ответом агента в Telegram. Тот же путь, что кнопки
 * в CRM: права проверяет assignPlan (план должен быть в чате этого сотрудника).
 */
async function onPlanButton(query: TelegramBot.CallbackQuery): Promise<void> {
  const [, , planId, action] = (query.data ?? '').split(':');
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const user = chatId != null ? await agentUserByChat(chatId) : null;
  if (!user || !planId || chatId == null || messageId == null) {
    await telegramService.answerCallback(query.id, 'Нет доступа');
    return;
  }
  try {
    if (action === 'y') {
      const r = await assignPlan(planId, user.id);
      await telegramService.answerCallback(query.id, `Роздано задач: ${r.createdTasks}`);
      const warn = r.warnings.length ? `\n⚠️ ${esc(r.warnings.join('; '))}` : '';
      await telegramService.sendHtmlToChat(chatId, `✅ План «${esc(r.plan.title)}» роздан: задач ${r.createdTasks}.${warn}`, [[{ text: 'Открыть задачи', url: '/tasks' }]]);
    } else {
      const p = await discardPlan(planId, user.id);
      await telegramService.answerCallback(query.id, 'План отклонён');
      await telegramService.sendHtmlToChat(chatId, `✖ План «${esc(p.title)}» отклонён.`);
    }
  } catch (err) {
    // План уже роздан/отклонён (в CRM или вторым нажатием) — просто объясняем.
    await telegramService.answerCallback(query.id, (err as Error).message.slice(0, 190));
  }
  // Остальные кнопки плана под этим сообщением больше не нужны — оставляем только ссылку.
  await telegramService.clearButtons(chatId, messageId);
}

async function onPrivateText(msg: TelegramBot.Message): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { telegramChatId: String(msg.chat.id) },
    select: { id: true, role: true, permissions: true, moneyAccess: true, isActive: true },
  });
  if (!user || !hasAgentAccess(user)) return;

  const text = (msg.text ?? '').trim();
  const command = text.startsWith('/') ? text.split(/\s|@/)[0].toLowerCase() : null;
  if (command === '/help') {
    await telegramService.sendHtmlToChat(msg.chat.id, HELP);
    return;
  }
  if (command === '/new') {
    await createChat(user.id, 'telegram');
    await telegramService.sendHtmlToChat(msg.chat.id, '🆕 Новый разговор. Какое задание?');
    return;
  }
  if (command === '/digest') {
    await telegramService.sendTyping(msg.chat.id);
    const { html, buttons } = digestMessage(await digestFor(tashkentYesterday()));
    await telegramService.sendHtmlToChat(msg.chat.id, html, buttons);
    return;
  }
  if (command) {
    await telegramService.sendHtmlToChat(msg.chat.id, HELP);
    return;
  }
  await answer(msg.chat.id, user.id, text);
}

/** Длиннее — это уже не задание, а лекция; и распознавание дорожает. */
const MAX_VOICE_SEC = 5 * 60;

/**
 * Голосовое директора: расшифровываем, показываем, что услышали (чтобы было видно
 * ошибку распознавания), и отдаём агенту как обычный текст.
 */
async function onPrivateVoice(msg: TelegramBot.Message): Promise<void> {
  const user = await agentUserByChat(msg.chat.id);
  if (!user) return;
  const media = msg.voice ?? msg.audio;
  if (!media) return;
  if ((media.duration ?? 0) > MAX_VOICE_SEC) {
    await telegramService.sendHtmlToChat(msg.chat.id, `⚠️ Голосовое длиннее ${MAX_VOICE_SEC / 60} минут — разбейте на части или напишите текстом.`);
    return;
  }

  const statusId = await telegramService.sendHtmlToChat(msg.chat.id, '🎙 Слушаю…');
  await telegramService.sendTyping(msg.chat.id);
  const dir = path.resolve(config.uploads.dir, 'tg-voice');
  let file: string | null = null;
  let text: string;
  try {
    await fs.mkdir(dir, { recursive: true });
    file = await telegramService.downloadFile(media.file_id, dir);
    text = await transcribeVoiceNote(file);
  } catch (err) {
    const reason = err instanceof AppError ? err.message : 'Не удалось распознать голосовое. Попробуйте ещё раз или напишите текстом.';
    if (!(err instanceof AppError)) console.error('[rop-voice] failed:', (err as Error).message);
    if (statusId) await telegramService.editHtmlMessage(msg.chat.id, statusId, `⚠️ ${esc(reason)}`);
    return;
  } finally {
    if (file) await fs.unlink(file).catch(() => {});
  }

  if (statusId) await telegramService.editHtmlMessage(msg.chat.id, statusId, `🎙 <i>${esc(text)}</i>`);
  await answer(msg.chat.id, user.id, `🎙 ${text}`);
}

telegramService.onPrivateText(onPrivateText);
telegramService.onPrivateVoice(onPrivateVoice);
telegramService.onCallback('rop:p:', onPlanButton);
