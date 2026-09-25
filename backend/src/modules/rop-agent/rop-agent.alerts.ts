import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import type TelegramBot from 'node-telegram-bot-api';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { SQL_EXCLUDE_INTERNAL_COMPANY_DEAL } from '../../lib/analytics';
import { agentBot, type TgButton } from './rop-agent.bot';
import { clientPurchaseCycles } from './rop-agent.analysis';
import { taskPlanResults } from './rop-agent.control';
import { activeMemories, memoryText } from './rop-agent.memory';
import { assignPlan, proposeTaskPlan } from './rop-agent.plans';
import { kpiForecast } from './rop-agent.kpi';
import { getTelegramChat } from './rop-agent.service';
import { agentUserByTelegramId, broadcastTargets, shortMoney } from './rop-agent.telegram';

/**
 * Сигналы РОП-агента: он сам пишет директору, когда что-то требует решения, и сразу
 * предлагает задачу менеджеру — «Поставить» одной кнопкой в Telegram (или в CRM).
 *
 * Кандидаты находятся по данным без модели; модель решает, стоит ли беспокоить
 * директора с учётом памяти («Print House платит в конце месяца» → не поднимать),
 * и пишет текст. Каждый кандидат записывается в rop_alerts по ключу — одно и то же
 * событие второй раз не приходит, а новый порог (просрочка перешла с 14 на 30 дней)
 * даёт новый ключ.
 */

type Proposal = { managerId: string; managerName: string; clientId: string | null; title: string; description: string; dueDate: string };

type Candidate = {
  kind: 'debt' | 'lapsed' | 'plan' | 'kpi';
  key: string;
  /** Для сортировки: чем больше, тем важнее. */
  weight: number;
  facts: Record<string, unknown>;
  managerId: string | null;
  managerName: string | null;
  clientId: string | null;
  defaultMessage: string;
  defaultTask: { title: string; description: string } | null;
};

const MAX_REVIEW = 15;
const MAX_SEND_PER_RUN = 3;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tashkentDate = (offsetDays = 0) => new Date(Date.now() + 5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;

// ─── Кандидаты ──────────────────────────────────────────────────────────────

async function debtCandidates(): Promise<Candidate[]> {
  const today = tashkentDate();
  const overdueDays = Prisma.sql`(${today}::date - DATE((d.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'))`;
  const rows = await prisma.$queryRaw<{
    client_id: string; client: string; manager_id: string; manager: string; overdue: number; max_days: number; deals: number;
  }[]>(Prisma.sql`
    SELECT c.id AS client_id, c.company_name AS client, c.manager_id, u.full_name AS manager,
      SUM(d.amount - d.paid_amount)::float8 AS overdue, MAX(${overdueDays})::int AS max_days, COUNT(*)::int AS deals
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    JOIN users u ON u.id = c.manager_id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND d.payment_status IN ('UNPAID', 'PARTIAL') AND (d.amount - d.paid_amount) > 0
      AND d.due_date IS NOT NULL AND ${overdueDays} >= 7
      AND c.relation = 'CUSTOMER'
      AND ${SQL_EXCLUDE_INTERNAL_COMPANY_DEAL}
    GROUP BY c.id, c.company_name, c.manager_id, u.full_name
    HAVING SUM(d.amount - d.paid_amount) >= ${config.ropAgent.alertDebtMin}
    ORDER BY overdue DESC
    LIMIT 30`);
  return rows.map((r) => {
    const bucket = r.max_days >= 60 ? 60 : r.max_days >= 30 ? 30 : r.max_days >= 14 ? 14 : 7;
    return {
      kind: 'debt',
      key: `debt:${r.client_id}:${bucket}`,
      weight: r.overdue,
      facts: { client: r.client, manager: r.manager, overdue_debt: r.overdue, max_overdue_days: r.max_days, overdue_deals: r.deals },
      managerId: r.manager_id,
      managerName: r.manager,
      clientId: r.client_id,
      defaultMessage: `${r.client} просрочил ${shortMoney(r.overdue)} сум (до ${r.max_days} дн., сделок: ${r.deals}). Ведёт ${r.manager}.`,
      defaultTask: {
        title: `Долг ${r.client}: ${shortMoney(r.overdue)}, просрочка ${r.max_days} дн.`,
        description: 'Связаться с клиентом, узнать причину и дату оплаты. Итог и дату — в отчёте задачи.',
      },
    };
  });
}

async function lapsedCandidates(): Promise<Candidate[]> {
  const r = await clientPurchaseCycles({ status: 'overdue', limit: 200 });
  return r.clients
    .filter((c) => c.revenue_12m >= config.ropAgent.alertClientMin)
    .map((c) => ({
      kind: 'lapsed' as const,
      key: `lapsed:${c.client_id}:${c.last_order}`,
      weight: c.revenue_12m,
      facts: {
        client: c.client, manager: c.manager, revenue_12m: c.revenue_12m, orders: c.orders,
        usual_interval_days: c.cycle_days, days_since_last_order: c.days_since, last_contact_at: c.last_contact_at,
        top_products: c.top_products_12m.map((p) => p.product),
      },
      managerId: c.manager_id,
      managerName: c.manager,
      clientId: c.client_id,
      defaultMessage: `${c.client} (${shortMoney(c.revenue_12m)} сум за год) не покупает ${c.days_since} дн. при обычном интервале ${Math.round(c.cycle_days)} дн. Ведёт ${c.manager}.`,
      defaultTask: {
        title: `Вернуть ${c.client}: тишина ${c.days_since} дн.`,
        description: `Позвонить, узнать причину паузы. Обычно берёт: ${c.top_products_12m.map((p) => p.product).join(', ') || '—'}. Итог — в отчёте.`,
      },
    }));
}

async function planCandidates(): Promise<Candidate[]> {
  const r = await taskPlanResults({ days: 30 });
  return r.plans.flatMap((p) => p.items
    .filter((i) => i.overdue && (i.verdict === 'behind' || i.verdict === 'no_touch'))
    .map((i) => ({
      kind: 'plan' as const,
      key: `plan:${p.planId}:${i.key}`,
      weight: i.summary.clients - i.summary.touched,
      facts: {
        plan: p.title, manager: i.managerName, due_date: i.dueDate, clients: i.summary.clients, worked: i.summary.touched,
        checked_without_trace: i.summary.checkedWithoutTrace, verdict: i.verdict, manager_reports: i.reports,
      },
      managerId: i.managerId,
      managerName: i.managerName,
      clientId: null,
      defaultMessage: `${i.managerName}: срок по задаче «${i.title}» прошёл, отработано ${i.summary.touched} из ${i.summary.clients}.`,
      defaultTask: null,
    })));
}

/**
 * Менеджер не успевает план: после первой недели месяца, прогноз ниже 70% (и отдельно
 * ниже 50%) — один сигнал на порог в месяц.
 */
async function kpiCandidates(): Promise<Candidate[]> {
  const day = new Date(Date.now() + 5 * 3600_000).getUTCDate();
  if (day < 8) return [];
  const f = await kpiForecast({});
  return f.managers
    .filter((m) => m.plan && m.forecast_pct != null && m.forecast_pct < 70)
    .map((m) => {
      const bucket = m.forecast_pct! < 50 ? 50 : 70;
      return {
        kind: 'kpi' as const,
        key: `kpi:${m.manager_id}:${f.period}:${bucket}`,
        weight: m.gap_to_plan ?? 0,
        facts: {
          manager: m.manager, period: f.period, days_passed: f.days_passed, days_in_month: f.days_in_month,
          plan: m.plan, fact: m.fact_mtd, forecast: m.forecast, forecast_pct: m.forecast_pct, gap: m.gap_to_plan,
          need_per_work_day: m.need_per_work_day, avg_per_work_day: m.avg_per_work_day, open_pipeline: m.open_pipeline,
        },
        managerId: m.manager_id,
        managerName: m.manager,
        clientId: null,
        defaultMessage: `${m.manager}: по прогнозу ${m.forecast_pct}% плана (${shortMoney(m.forecast)} из ${shortMoney(m.plan!)}), не хватает ${shortMoney(m.gap_to_plan ?? 0)}. Нужно ${shortMoney(m.need_per_work_day ?? 0)} в день против ${shortMoney(m.avg_per_work_day)} сейчас.`,
        defaultTask: {
          title: `План добора до конца месяца: ${shortMoney(m.gap_to_plan ?? 0)}`,
          description: 'Составить список: открытые сделки, которые можно закрыть в этом месяце, и клиенты, которым пора покупать. По каждому — сумма и дата. Итог — в отчёте задачи.',
        },
      };
    });
}

async function findNewCandidates(): Promise<Candidate[]> {
  const all = (await Promise.all([debtCandidates(), lapsedCandidates(), planCandidates(), kpiCandidates()])).flat();
  if (!all.length) return [];
  const seen = await prisma.ropAlert.findMany({ where: { key: { in: all.map((c) => c.key) } }, select: { key: true } });
  const seenKeys = new Set(seen.map((s) => s.key));
  // Сначала срывы задач, потом долги и клиенты — по сумме.
  const order = { plan: 0, kpi: 1, debt: 2, lapsed: 3 };
  return all
    .filter((c) => !seenKeys.has(c.key))
    .sort((a, b) => order[a.kind] - order[b.kind] || b.weight - a.weight)
    .slice(0, MAX_REVIEW);
}

// ─── Решение модели ─────────────────────────────────────────────────────────

type Review = {
  key: string;
  send: boolean;
  /** Не присылать никогда (по памяти или по сути), а не просто «менее срочно сейчас». */
  permanent_skip: boolean;
  reason: string;
  message: string;
  task_title: string;
  task_description: string;
};

const REVIEW_PROMPT = `Ты — РОП-агент компании Polygraph Business (Ташкент, расходники для типографий, деньги в сумах), помощник директора.
Тебе дают найденные в CRM события и память агента — действующие договорённости директора.
Для каждого события реши, стоит ли сейчас беспокоить директора сообщением в Telegram.
- Не беспокой, если память это объясняет (клиент по договорённости платит позже, директор просил не поднимать) — send=false, permanent_skip=true и причина в reason.
- Отправь не больше ${MAX_SEND_PER_RUN} самых важных; остальные send=false, permanent_skip=false (вернёмся к ним позже).
- message — 1–2 предложения директору, с именами и цифрами, суммы коротко («18,4 млн»). Без приветствий.
- task_title / task_description — задача менеджеру, которую ты предлагаешь поставить (конкретно: что сделать и что написать в отчёте). Если менеджер в отпуске по памяти — напиши это в message. Если задача не нужна (например, по сорванному плану нужен разговор директора с менеджером) — пустые строки.
Ответь строго JSON по схеме.`;

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    alerts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          send: { type: 'boolean' },
          permanent_skip: { type: 'boolean' },
          reason: { type: 'string' },
          message: { type: 'string' },
          task_title: { type: 'string' },
          task_description: { type: 'string' },
        },
        required: ['key', 'send', 'permanent_skip', 'reason', 'message', 'task_title', 'task_description'],
        additionalProperties: false,
      },
    },
  },
  required: ['alerts'],
  additionalProperties: false,
};

/** Без ключа или при сбое модели — самые важные по порядку, со стандартным текстом. */
function fallbackReview(candidates: Candidate[]): Review[] {
  return candidates.map((c, i) => ({
    key: c.key,
    send: i < MAX_SEND_PER_RUN,
    permanent_skip: false,
    reason: i < MAX_SEND_PER_RUN ? '' : 'менее важно',
    message: c.defaultMessage,
    task_title: c.defaultTask?.title ?? '',
    task_description: c.defaultTask?.description ?? '',
  }));
}

async function reviewCandidates(candidates: Candidate[]): Promise<Review[]> {
  if (!config.claude.apiKey) return fallbackReview(candidates);
  try {
    const client = new Anthropic({ apiKey: config.claude.apiKey });
    const input = candidates.map((c) => ({ key: c.key, kind: c.kind, facts: c.facts }));
    const response = await client.messages.create({
      model: config.ropAgent.digestModel,
      max_tokens: 8000,
      system: REVIEW_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
      messages: [{
        role: 'user',
        content: `Сегодня ${tashkentDate()}.\n\nПамять агента:\n${memoryText(await activeMemories())}\n\nСобытия:\n${JSON.stringify(input)}`,
      }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return fallbackReview(candidates);
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text) as { alerts: Review[] };
    const byKey = new Map(parsed.alerts.map((a) => [a.key, a]));
    // Модель могла пропустить кандидата — его решаем по умолчанию (не отправлять).
    return candidates.map((c) => byKey.get(c.key) ?? { key: c.key, send: false, permanent_skip: false, reason: 'модель не оценила', message: c.defaultMessage, task_title: '', task_description: '' });
  } catch (err) {
    console.error('[rop-alerts] review failed, using defaults:', (err as Error).message);
    return fallbackReview(candidates);
  }
}

// ─── Отправка ───────────────────────────────────────────────────────────────

function alertHtml(message: string, proposal: Proposal | null, footer?: string): string {
  const lines = [`🔔 <b>РОП-агент</b>`, esc(message)];
  if (proposal) {
    lines.push('', `Предлагаю задачу для <b>${esc(proposal.managerName)}</b> до ${ddmm(proposal.dueDate)}:`, `«${esc(proposal.title)}»`);
  }
  if (footer) lines.push('', footer);
  return lines.join('\n');
}

function alertButtons(alertId: string, proposal: Proposal | null, clientId: string | null): TgButton[][] {
  const rows: TgButton[][] = proposal
    ? [[{ text: '✅ Поставить задачу', callback: `rop:a:${alertId}:y` }, { text: '✖ Не надо', callback: `rop:a:${alertId}:n` }]]
    : [[{ text: '👌 Понял', callback: `rop:a:${alertId}:n` }]];
  if (clientId) rows.push([{ text: 'Открыть клиента', url: `/clients/${clientId}` }]);
  return rows;
}

/** Один проход: найти новые события, дать модели решить, отправить важное. */
export async function runAlerts(): Promise<{ reviewed: number; sent: number }> {
  const todayStart = new Date(`${tashkentDate()}T00:00:00+05:00`);
  const sentToday = await prisma.ropAlert.count({ where: { createdAt: { gte: todayStart }, status: { not: 'SKIPPED' } } });
  const allowed = Math.min(MAX_SEND_PER_RUN, config.ropAgent.alertsPerDay - sentToday);
  if (allowed <= 0) return { reviewed: 0, sent: 0 };

  const candidates = await findNewCandidates();
  if (!candidates.length) return { reviewed: 0, sent: 0 };
  const reviews = await reviewCandidates(candidates);
  const recipients = agentBot.enabled ? broadcastTargets() : [];
  const dueDate = tashkentDate(1);

  let sent = 0;
  for (const c of candidates) {
    const r = reviews.find((x) => x.key === c.key)!;
    const send = r.send && sent < allowed && recipients.length > 0;
    // «Менее срочно сейчас», упёрлись в лимит или некому слать — не записываем: пересмотрим в следующий раз.
    if (!send && !(r.send === false && r.permanent_skip)) continue;
    const proposal: Proposal | null = send && r.task_title.trim() && c.managerId
      ? { managerId: c.managerId, managerName: c.managerName ?? '', clientId: c.clientId, title: r.task_title.trim(), description: r.task_description.trim(), dueDate }
      : null;
    const alert = await prisma.ropAlert.create({
      data: {
        kind: c.kind,
        key: c.key,
        status: send ? 'SENT' : 'SKIPPED',
        payload: c.facts as Prisma.InputJsonValue,
        message: r.message || c.defaultMessage,
        proposal: (proposal ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        reason: send ? null : r.reason || null,
      },
    });
    if (!send) continue;
    const html = alertHtml(alert.message!, proposal);
    const buttons = alertButtons(alert.id, proposal, c.clientId);
    const messages: { chatId: string; messageId: number }[] = [];
    for (const target of recipients) {
      const id = await agentBot.sendHtmlToChat(target, html, buttons);
      if (id) messages.push({ chatId: target, messageId: id });
    }
    await prisma.ropAlert.update({ where: { id: alert.id }, data: { messages } });
    sent++;
  }
  return { reviewed: candidates.length, sent };
}

// ─── Решение директора ──────────────────────────────────────────────────────

/**
 * «Поставить задачу» / «Не надо» — из Telegram или со страницы. Решение принимается
 * один раз: у второго получателя кнопки исчезают, в сообщении видно, кто решил.
 */
export async function decideAlert(alertId: string, userId: string, accept: boolean) {
  const alert = await prisma.ropAlert.findUnique({ where: { id: alertId } });
  if (!alert) throw new AppError(404, 'Сигнал не найден');
  if (alert.status !== 'SENT') throw new AppError(409, 'По этому сигналу уже решили');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
  const proposal = alert.proposal as unknown as Proposal | null;

  // Захватываем решение атомарно: два нажатия одновременно не создадут две задачи.
  const claimed = await prisma.ropAlert.updateMany({
    where: { id: alertId, status: 'SENT' },
    data: { status: accept && proposal ? 'ACCEPTED' : 'DECLINED', decidedById: userId, decidedAt: new Date() },
  });
  if (!claimed.count) throw new AppError(409, 'По этому сигналу уже решили');

  let footer = accept && proposal ? '' : `✖ ${esc(user.fullName)}: не надо`;
  if (accept && proposal) {
    try {
      const chat = await getTelegramChat(userId);
      const plan = await proposeTaskPlan({ chatId: chat.id, userId }, {
        title: proposal.title,
        goal: alert.message,
        tasks: [{
          manager_id: proposal.managerId,
          title: proposal.title,
          description: proposal.description,
          due_date: proposal.dueDate,
          // Суть уже в названии и описании задачи — в чек-листе только клиент с телефоном.
          clients: proposal.clientId ? [{ client_id: proposal.clientId, reason: '', offer: '' }] : [],
        }],
      });
      await assignPlan(plan.plan_id, userId);
      await prisma.ropAlert.update({ where: { id: alertId }, data: { planId: plan.plan_id } });
      footer = `✅ ${esc(user.fullName)}: задача поставлена ${esc(proposal.managerName)}`;
    } catch (err) {
      // Задачу поставить не вышло — возвращаем сигнал, чтобы можно было нажать ещё раз.
      await prisma.ropAlert.update({ where: { id: alertId }, data: { status: 'SENT', decidedById: null, decidedAt: null } });
      throw err;
    }
  }

  const messages = (alert.messages as { chatId: string; messageId: number }[] | null) ?? [];
  const html = alertHtml(alert.message ?? '', proposal, footer);
  const link: TgButton[][] = proposal?.clientId ? [[{ text: 'Открыть клиента', url: `/clients/${proposal.clientId}` }]] : [];
  await Promise.all(messages.map((m) => agentBot.editHtmlMessage(m.chatId, m.messageId, html, link)));
  return prisma.ropAlert.findUniqueOrThrow({ where: { id: alertId } });
}

export function listAlerts(limit = 30) {
  return prisma.ropAlert.findMany({
    where: { status: { not: 'SKIPPED' } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, kind: true, status: true, message: true, proposal: true, planId: true, decidedAt: true, createdAt: true },
  });
}

/**
 * Сигналы, ждущие решения, — по кнопке «🔔 Сигналы» / команде /alerts. Новые сообщения
 * дописываются в alert.messages, чтобы после решения кнопки убрались и у них.
 */
export async function sendOpenAlerts(chatId: number | string): Promise<number> {
  const open = await prisma.ropAlert.findMany({ where: { status: 'SENT' }, orderBy: { createdAt: 'desc' }, take: 10 });
  for (const alert of open.reverse()) {
    const proposal = alert.proposal as unknown as Proposal | null;
    const id = await agentBot.sendHtmlToChat(chatId, alertHtml(alert.message ?? '', proposal), alertButtons(alert.id, proposal, proposal?.clientId ?? null));
    if (id) {
      const messages = [...((alert.messages as { chatId: string; messageId: number }[] | null) ?? []), { chatId: String(chatId), messageId: id }];
      await prisma.ropAlert.update({ where: { id: alert.id }, data: { messages } });
    }
  }
  return open.length;
}

async function onAlertButton(query: TelegramBot.CallbackQuery): Promise<void> {
  const [, , alertId, action] = (query.data ?? '').split(':');
  const user = await agentUserByTelegramId(query.from.id);
  if (!user || !alertId) {
    await agentBot.answerCallback(query.id, 'Нет доступа');
    return;
  }
  try {
    await decideAlert(alertId, user.id, action === 'y');
    await agentBot.answerCallback(query.id, action === 'y' ? 'Задача поставлена' : 'Ок');
  } catch (err) {
    await agentBot.answerCallback(query.id, (err as Error).message.slice(0, 190));
  }
}

agentBot.onCallback('rop:a:', onAlertButton);
