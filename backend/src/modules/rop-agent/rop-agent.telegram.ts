import type TelegramBot from 'node-telegram-bot-api';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { PERMISSIONS } from '../../lib/permissions';
import { telegramService } from '../telegram/telegram.service';
import { buildDigest, tashkentYesterday, type DigestData } from './rop-agent.digest';
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

/**
 * Получатели ежедневной сводки — только с правом use_rop_agent, выданным явно:
 * суперадминов в компании может быть больше, чем тех, кому нужна сводка.
 */
async function digestRecipients(): Promise<AgentUser[]> {
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
    button: { text: '📊 Открыть сводку в CRM', url: `/rop-agent/digest?date=${digest.date}` },
  };
}

/** Утренняя рассылка: всем получателям, отмечает sentAt. Возвращает, скольким ушло. */
export async function sendDigestToRecipients(date: string): Promise<number> {
  const digest = await digestFor(date);
  const recipients = await digestRecipients();
  const { html, button } = digestMessage(digest);
  let sent = 0;
  for (const u of recipients) {
    if (await telegramService.sendHtmlToChat(u.telegramChatId, html, button)) sent++;
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
  const { html, button } = digestMessage(digest);
  const ok = await telegramService.sendHtmlToChat(user.telegramChatId, html, button);
  if (!ok) throw new AppError(502, 'Telegram не принял сообщение. Проверьте, что бот не заблокирован.');
}

// ─── Разговор в личке ───────────────────────────────────────────────────────

const HELP = [
  '<b>РОП-агент</b>',
  'Пишите задание или вопрос обычным текстом — агент изучит данные CRM и ответит.',
  '',
  '/new — начать новый разговор',
  '/digest — сводка за вчера',
  '/help — эта подсказка',
  '',
  'Планы задач агент готовит черновиком — раздаются они в CRM кнопкой «Раздать».',
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
  const planIds = ((reply.toolCalls as { planId?: string }[] | null) ?? []).map((t) => t.planId).filter(Boolean);
  const html = reply.isError ? `⚠️ ${esc(reply.text)}` : markdownToTelegramHtml(reply.text);
  await telegramService.sendHtmlToChat(
    chatId,
    html || '…',
    planIds.length
      ? { text: '📝 Открыть план задач в CRM', url: `/rop-agent?chat=${chat.id}` }
      : { text: 'Открыть разговор в CRM', url: `/rop-agent?chat=${chat.id}` },
  );
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
    const { html, button } = digestMessage(await digestFor(tashkentYesterday()));
    await telegramService.sendHtmlToChat(msg.chat.id, html, button);
    return;
  }
  if (command) {
    await telegramService.sendHtmlToChat(msg.chat.id, HELP);
    return;
  }
  await answer(msg.chat.id, user.id, text);
}

telegramService.onPrivateText(onPrivateText);
