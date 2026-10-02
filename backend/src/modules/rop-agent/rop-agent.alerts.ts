import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import type TelegramBot from 'node-telegram-bot-api';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { agentBot, type TgButton } from './rop-agent.bot';
import { clientPurchaseCycles, recentClientNotes, NO_CONTACT_NOTE_RE, VAGUE_NOTE_SQL, type RecentNote } from './rop-agent.analysis';
import { taskPlanResults } from './rop-agent.control';
import { activeMemories, memoryText } from './rop-agent.memory';
import { appendClientToPlan, assignPlan, proposeTaskPlan, type PlanItem } from './rop-agent.plans';
import { kpiForecast } from './rop-agent.kpi';
import { getTelegramChat } from './rop-agent.service';
import { broadcastTargets, callbackUser, shortMoney } from './rop-agent.telegram';
import { assignableManagerIds, directorUserIds } from './rop-agent.people';
import { isDayOff } from './rop-agent.calendar';

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
  kind: 'debt' | 'lapsed' | 'plan' | 'kpi' | 'notes';
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
    GROUP BY c.id, c.company_name, c.manager_id, u.full_name
    HAVING SUM(d.amount - d.paid_amount) >= ${config.ropAgent.alertDebtMin}
    ORDER BY overdue DESC
    LIMIT 30`);
  const notes = await recentClientNotes(rows.map((r) => r.client_id));
  return rows.map((r) => {
    const bucket = r.max_days >= 60 ? 60 : r.max_days >= 30 ? 30 : r.max_days >= 14 ? 14 : 7;
    return {
      kind: 'debt',
      key: `debt:${r.client_id}:${bucket}`,
      weight: r.overdue,
      facts: {
        client: r.client, manager: r.manager, overdue_debt: r.overdue, max_overdue_days: r.max_days, overdue_deals: r.deals,
        recent_notes: notes.get(r.client_id) ?? [],
      },
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

/** Клиенты, которые уже есть в розданных за неделю задачах агента: по ним не дёргаем повторно. */
async function clientsInRecentTasks(): Promise<Set<string>> {
  const plans = await prisma.ropTaskPlan.findMany({
    where: { status: 'ASSIGNED', assignedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    select: { items: true },
  });
  return new Set(plans.flatMap((p) => (p.items as unknown as PlanItem[]).flatMap((i) => i.clients.map((c) => c.clientId))));
}

async function lapsedCandidates(): Promise<Candidate[]> {
  const [r, inTasks] = await Promise.all([clientPurchaseCycles({ status: 'overdue', limit: 200 }), clientsInRecentTasks()]);
  const list = r.clients.filter((c) => c.revenue_12m >= config.ropAgent.alertClientMin && !inTasks.has(c.client_id));
  const notes = await recentClientNotes(list.map((c) => c.client_id));
  return list
    .map((c) => ({
      kind: 'lapsed' as const,
      key: `lapsed:${c.client_id}:${c.last_order}`,
      weight: c.revenue_12m,
      facts: {
        client: c.client, manager: c.manager, revenue_12m: c.revenue_12m, orders: c.orders,
        usual_interval_days: c.cycle_days, days_since_last_order: c.days_since, last_contact_at: c.last_contact_at,
        top_products: c.top_products_12m.map((p) => p.product),
        recent_notes: notes.get(c.client_id) ?? ([] as RecentNote[]),
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
        plan: p.title, manager: i.managerName, due_date: i.dueDate, clients_in_task: i.summary.clients,
        clients_worked: i.summary.touched, ticked_without_call_or_note: i.summary.checkedWithoutTrace,
        manager_reports: i.reports,
        not_worked: i.clients.filter((c) => !c.answered && !c.notes).slice(0, 10).map((c) => c.client),
        last_notes: i.clients.filter((c) => c.last_note).slice(0, 5).map((c) => `${c.client}: ${c.last_note}`),
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
        // Отставание от плана — разговор директора с менеджером, а не задача менеджеру.
        defaultTask: null,
      };
    });
}

/**
 * Пустые заметки: за неделю у менеджера много заметок вида «всего хватает» или в пару слов
 * (недозвоны не в счёт). Не чаще раза в неделю на менеджера — директору, с примерами и
 * предложением задачи «пишите заметки подробно».
 */
async function notesCandidates(): Promise<Candidate[]> {
  const assignable = [...await assignableManagerIds()];
  if (!assignable.length) return [];
  const content = Prisma.sql`n.content`;
  const rows = await prisma.$queryRaw<{
    manager_id: string; manager: string; notes: number; vague: number; no_contact: number; examples: string[] | null;
  }[]>(Prisma.sql`
    SELECT n.user_id AS manager_id, u.full_name AS manager,
      COUNT(*)::int AS notes,
      COUNT(*) FILTER (WHERE ${VAGUE_NOTE_SQL(content)})::int AS vague,
      COUNT(*) FILTER (WHERE n.content ~* ${NO_CONTACT_NOTE_RE})::int AS no_contact,
      (array_agg(c.company_name || ': ' || LEFT(btrim(n.content), 120) ORDER BY n.created_at DESC)
        FILTER (WHERE ${VAGUE_NOTE_SQL(content)}))[1:6] AS examples
    FROM client_notes n
    JOIN users u ON u.id = n.user_id
    JOIN clients c ON c.id = n.client_id
    WHERE n.deleted_at IS NULL AND n.created_at >= NOW() - INTERVAL '7 days' AND n.user_id = ANY(${assignable})
    GROUP BY n.user_id, u.full_name
    HAVING COUNT(*) >= 10`);
  // Ключ — неделя (её понедельник): не чаще раза в неделю на менеджера.
  const today = new Date(`${tashkentDate()}T00:00:00Z`);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  return rows
    .filter((r) => r.vague / r.notes >= 0.4)
    .map((r) => ({
      kind: 'notes' as const,
      key: `notes:${r.manager_id}:${monday}`,
      weight: r.vague,
      facts: {
        manager: r.manager, notes_7d: r.notes, empty_notes_7d: r.vague, empty_share_pct: Math.round((r.vague / r.notes) * 100),
        no_answer_notes_7d: r.no_contact, examples: r.examples ?? [],
      },
      managerId: r.manager_id,
      managerName: r.manager,
      clientId: null,
      defaultMessage: `${r.manager}: за неделю ${r.vague} из ${r.notes} заметок без сути («всего хватает», пара слов) — не видно, что клиент берёт, у кого и когда купит.`,
      defaultTask: {
        title: 'Пишите заметки по клиентам подробно',
        description: 'В каждой заметке после разговора: что клиент берёт сейчас и у кого, по какой цене, на сколько хватит запаса, '
          + 'когда следующая закупка, что вы предложили (товар, объём, цена) и что он ответил. '
          + '«Всего хватает» без деталей — не заметка: спросите, на сколько хватит и у кого брал в прошлый раз.',
      },
    }));
}

async function findNewCandidates(): Promise<Candidate[]> {
  const all = (await Promise.all([debtCandidates(), lapsedCandidates(), planCandidates(), kpiCandidates(), notesCandidates()])).flat();
  if (!all.length) return [];
  const seen = await prisma.ropAlert.findMany({ where: { key: { in: all.map((c) => c.key) } }, select: { key: true } });
  const seenKeys = new Set(seen.map((s) => s.key));
  // Сначала срывы задач, потом долги и клиенты — по сумме.
  const order = { plan: 0, kpi: 1, notes: 2, debt: 3, lapsed: 4 };
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
- Если manager_is_director = true — клиента ведёт сам директор: задачу НЕ предлагай (пустые строки), в message дай совет директору, что сделать самому.
- Если manager_can_take_tasks = false — клиент закреплён за сотрудником, который не продаёт (админ, тестовая или пустая учётка): задачу не предлагай, в message предложи директору передать клиента живому менеджеру.
- task_title / task_description — задача менеджеру, которую ты предлагаешь поставить (конкретно: что сделать и что написать в заметке клиента). Если менеджер в отпуске по памяти — напиши это в message.
- kind = plan и kind = kpi — это разговор директора с менеджером: задачу не предлагай (пустые строки), в message — что именно обсудить, по фактам.

Заметки менеджеров (recent_notes, last_notes, examples) читай обязательно — это то, что менеджер уже выяснил:
- В заметке есть причина или договорённость («придёт 8 октября», «ждёт поставку», «ушёл к конкуренту из-за отсрочки», «закрылся») — не предлагай «позвонить и выяснить». Срок договорённости ещё не наступил — send=false, permanent_skip=false. Причина потери — скажи директору причину и что с ней можно сделать (условия, товар, цена); задачу менеджеру — только если есть что конкретно предложить клиенту.
- Заметка без сути («всего хватает», «пока не нужно», «сам позвонит», пара слов) — это не ответ. Предложи задачу уточнить: у кого клиент берёт сейчас и по какой цене, на сколько хватит запаса, когда следующая закупка; предложить конкретный товар из top_products; записать ответы в заметку. В message прямо скажи директору, что заметка пустая, и процитируй её.
- Контакт был за последние 3 дня и заметка содержательная — не дёргай: send=false, permanent_skip=false.
- «Не взял трубку» — попытка, а не отработка: можно предложить перезвонить в другое время или написать в мессенджер.
- kind = notes — у менеджера много пустых заметок за неделю: приведи 2–3 примера из examples и предложи задачу писать заметки по схеме из task_description.

Пиши для людей: без английских слов и названий полей (worked, touched, overdue, behind, verdict, kind и т. п.), только по-русски и с именами.
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
    const [directors, assignable] = await Promise.all([directorUserIds(), assignableManagerIds()]);
    const input = candidates.map((c) => ({
      key: c.key,
      kind: c.kind,
      facts: {
        ...c.facts,
        manager_is_director: !!c.managerId && directors.has(c.managerId),
        manager_can_take_tasks: !!c.managerId && assignable.has(c.managerId),
      },
    }));
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
  // В воскресенье и праздники не дёргаем: менеджеры не работают.
  if (isDayOff(tashkentDate())) return { reviewed: 0, sent: 0 };
  const todayStart = new Date(`${tashkentDate()}T00:00:00+05:00`);
  const sentToday = await prisma.ropAlert.count({ where: { createdAt: { gte: todayStart }, status: { not: 'SKIPPED' } } });
  const allowed = Math.min(MAX_SEND_PER_RUN, config.ropAgent.alertsPerDay - sentToday);
  if (allowed <= 0) return { reviewed: 0, sent: 0 };

  const candidates = await findNewCandidates();
  if (!candidates.length) return { reviewed: 0, sent: 0 };
  const reviews = await reviewCandidates(candidates);
  const recipients = agentBot.enabled ? broadcastTargets() : [];
  // Задачи — только живым менеджерам продаж; по клиентам директора, админов и пустых учёток — совет.
  const assignable = await assignableManagerIds();
  const dueDate = tashkentDate(1);

  let sent = 0;
  for (const c of candidates) {
    const r = reviews.find((x) => x.key === c.key)!;
    const send = r.send && sent < allowed && recipients.length > 0;
    // «Менее срочно сейчас», упёрлись в лимит или некому слать — не записываем: пересмотрим в следующий раз.
    if (!send && !(r.send === false && r.permanent_skip)) continue;
    const canAssign = !!c.managerId && assignable.has(c.managerId) && c.kind !== 'plan' && c.kind !== 'kpi';
    const proposal: Proposal | null = send && canAssign && r.task_title.trim() && c.managerId
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
      const mergedInto = proposal.clientId ? await appendToTodaysTask(proposal) : null;
      if (mergedInto) {
        await prisma.ropAlert.update({ where: { id: alertId }, data: { planId: mergedInto } });
        footer = `✅ ${esc(user.fullName)}: клиент добавлен в сегодняшнюю задачу ${esc(proposal.managerName)}`;
      } else {
        const chat = await getTelegramChat(userId);
        const today = ddmm(tashkentDate());
        const plan = await proposeTaskPlan({ chatId: chat.id, userId }, proposal.clientId
          ? {
            // Клиентские сигналы за день копятся в одной задаче менеджера, суть — в пункте чек-листа.
            title: `Сигналы агента: ${proposal.managerName}, ${today}`,
            goal: alert.message,
            tasks: [{
              manager_id: proposal.managerId,
              title: `Связаться с клиентами — ${today}`,
              description: 'Позвоните каждому клиенту из чек-листа. Что выяснить или предложить — в пункте клиента.',
              due_date: proposal.dueDate,
              clients: [{ client_id: proposal.clientId, offer: proposal.title, reason: proposal.description }],
            }],
          }
          : {
            title: proposal.title,
            goal: alert.message,
            tasks: [{ manager_id: proposal.managerId, title: proposal.title, description: proposal.description, due_date: proposal.dueDate, clients: [] }],
          });
        await assignPlan(plan.plan_id, userId);
        await prisma.ropAlert.update({ where: { id: alertId }, data: { planId: plan.plan_id } });
        footer = `✅ ${esc(user.fullName)}: задача поставлена ${esc(proposal.managerName)}`;
      }
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

/** Сегодняшняя задача менеджера из клиентских сигналов, если в неё ещё можно дописать клиента. */
async function appendToTodaysTask(proposal: Proposal): Promise<string | null> {
  const accepted = await prisma.ropAlert.findMany({
    where: { status: 'ACCEPTED', planId: { not: null }, decidedAt: { gte: new Date(`${tashkentDate()}T00:00:00+05:00`) } },
    orderBy: { decidedAt: 'desc' },
    select: { planId: true, proposal: true },
  });
  const planIds = [...new Set(accepted
    .filter((a) => {
      const p = a.proposal as unknown as Proposal | null;
      return p?.managerId === proposal.managerId && !!p.clientId;
    })
    .map((a) => a.planId!))];
  for (const planId of planIds) {
    if (await appendClientToPlan(planId, { clientId: proposal.clientId!, offer: proposal.title, reason: proposal.description })) return planId;
  }
  return null;
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
  const user = await callbackUser(query, true);
  if (!user || !alertId) return;
  try {
    await decideAlert(alertId, user.id, action === 'y');
    await agentBot.answerCallback(query.id, action === 'y' ? 'Задача поставлена' : 'Ок');
  } catch (err) {
    await agentBot.answerCallback(query.id, (err as Error).message.slice(0, 190));
  }
}

agentBot.onCallback('rop:a:', onAlertButton);
