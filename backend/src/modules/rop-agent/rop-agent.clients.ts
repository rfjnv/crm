import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import {
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_DEALS_REVENUE_BASE_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
} from '../../lib/analytics';
import { clientPurchaseCycles } from './rop-agent.analysis';

/**
 * Клиент целиком и причины потерь — чтобы на вопрос «клиент ушёл, потому что мы не
 * даём в долг» агент отвечал по фактам: как клиент платил, сколько приносил, что писали
 * менеджеры, и сколько ещё клиентов ушло по той же причине.
 */

const TODAY = Prisma.sql`(NOW() AT TIME ZONE 'Asia/Tashkent')::date`;
const tDate = (col: Prisma.Sql) => Prisma.sql`DATE((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')`;
const ymd = (d: Date | null) => (d ? new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10) : null);

// ─── Карточка клиента ───────────────────────────────────────────────────────

const RELATION_LABELS: Record<string, string> = {
  CUSTOMER: 'клиент',
  AFFILIATE: 'своя / союзная компания — не клиент',
  COMPETITOR: 'конкурент — иногда докупает у нас при нехватке своего товара',
};

type ClientRow = {
  id: string; company_name: string; contact_name: string; phone: string | null; inn: string | null; relation: string;
  manager: string; is_svip: boolean; credit_status: string; is_archived: boolean; created_at: Date;
  portrait_profile: string | null; portrait_goals: string | null; portrait_pains: string | null;
  portrait_fears: string | null; portrait_objections: string | null;
};

async function findClient(input: { client_id?: string; search?: string }) {
  if (input.client_id) {
    const rows = await prisma.$queryRaw<ClientRow[]>(Prisma.sql`
      SELECT c.*, u.full_name AS manager FROM clients c JOIN users u ON u.id = c.manager_id WHERE c.id = ${input.client_id}`);
    return { client: rows[0] ?? null, candidates: [] as { client_id: string; client: string; manager: string; relation: string }[] };
  }
  const q = (input.search ?? '').trim();
  if (!q) throw new Error('Нужен client_id или search');
  const rows = await prisma.$queryRaw<(ClientRow & { exact: boolean })[]>(Prisma.sql`
    SELECT c.*, u.full_name AS manager, lower(c.company_name) = lower(${q}) AS exact
    FROM clients c JOIN users u ON u.id = c.manager_id
    WHERE c.company_name ILIKE ${`%${q}%`} OR c.phone ILIKE ${`%${q}%`} OR c.inn = ${q}
    ORDER BY exact DESC, c.is_archived, length(c.company_name)
    LIMIT 10`);
  const exact = rows.filter((r) => r.exact);
  const pick = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
  return {
    client: pick,
    candidates: pick ? [] : rows.map((r) => ({ client_id: r.id, client: r.company_name, manager: r.manager, relation: r.relation })),
  };
}

export async function clientCard(input: { client_id?: string; search?: string }) {
  const { client: c, candidates } = await findClient(input);
  if (!c) {
    return candidates.length
      ? { found: false, note: 'Под запрос подходят несколько клиентов — уточни client_id.', candidates }
      : { found: false, note: 'Клиент не найден.' };
  }
  const id = c.id;

  const [purchases, monthly, topProducts, payments, notes, calls, audits, openDeals, plans] = await Promise.all([
    // Покупки: дни с продажами, выручка, средний чек, обычный интервал.
    prisma.$queryRaw<{ orders: number; first_order: string | null; last_order: string | null; days_since: number | null; cycle_days: number | null; revenue_12m: number; revenue_total: number; deals: number }[]>(Prisma.sql`
      WITH lines AS (
        SELECT d.id AS deal_id, ${tDate(SQL_EFFECTIVE_REVENUE_ITEM_TS)} AS day, ${SQL_ANALYTICS_LINE_REVENUE_DI} AS revenue
        FROM deal_items di JOIN deals d ON d.id = di.deal_id
        WHERE ${SQL_DEALS_REVENUE_BASE_FILTER} AND d.client_id = ${id}
      ),
      days AS (SELECT day, SUM(revenue) AS revenue FROM lines GROUP BY day),
      g AS (SELECT day, day - LAG(day) OVER (ORDER BY day) AS gap FROM days)
      SELECT (SELECT COUNT(*) FROM days)::int AS orders,
        (SELECT to_char(MIN(day), 'YYYY-MM-DD') FROM days) AS first_order,
        (SELECT to_char(MAX(day), 'YYYY-MM-DD') FROM days) AS last_order,
        (SELECT (${TODAY} - MAX(day))::int FROM days) AS days_since,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) FROM g WHERE gap IS NOT NULL)::float8 AS cycle_days,
        (SELECT COALESCE(SUM(revenue), 0) FROM days WHERE day >= ${TODAY} - 365)::float8 AS revenue_12m,
        (SELECT COALESCE(SUM(revenue), 0) FROM days)::float8 AS revenue_total,
        (SELECT COUNT(DISTINCT deal_id) FROM lines)::int AS deals`),
    prisma.$queryRaw<{ month: string; revenue: number }[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', ${tDate(SQL_EFFECTIVE_REVENUE_ITEM_TS)}), 'YYYY-MM') AS month,
        SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::float8 AS revenue
      FROM deal_items di JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_BASE_FILTER} AND d.client_id = ${id}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ product: string; unit: string | null; qty: number; revenue: number; last_bought: string }[]>(Prisma.sql`
      SELECT p.name AS product, p.unit, SUM(di.requested_qty)::float8 AS qty,
        SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::float8 AS revenue,
        to_char(MAX(${tDate(SQL_EFFECTIVE_REVENUE_ITEM_TS)}), 'YYYY-MM-DD') AS last_bought
      FROM deal_items di JOIN deals d ON d.id = di.deal_id JOIN products p ON p.id = di.product_id
      WHERE ${SQL_DEALS_REVENUE_BASE_FILTER} AND d.client_id = ${id}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= NOW() - INTERVAL '12 months'
      GROUP BY p.name, p.unit ORDER BY revenue DESC LIMIT 8`),
    // Платёжная дисциплина: оплаченные со сроком — вовремя или с опозданием; неоплаченные — долг и просрочка.
    prisma.$queryRaw<{
      with_terms: number; prepaid_or_no_terms: number; paid_on_time: number; paid_late: number;
      avg_days_late: number | null; max_days_late: number | null; debt: number; overdue_debt: number;
      overdue_deals: number; max_overdue_days: number | null;
    }[]>(Prisma.sql`
      WITH d AS (
        SELECT d.id, d.amount, d.paid_amount, d.payment_status, ${tDate(Prisma.sql`d.due_date`)} AS due,
          (SELECT ${tDate(Prisma.sql`MAX(p.paid_at)`)} FROM payments p WHERE p.deal_id = d.id) AS last_paid
        FROM deals d
        WHERE d.client_id = ${id} AND d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
      )
      SELECT COUNT(*) FILTER (WHERE due IS NOT NULL)::int AS with_terms,
        COUNT(*) FILTER (WHERE due IS NULL)::int AS prepaid_or_no_terms,
        COUNT(*) FILTER (WHERE due IS NOT NULL AND payment_status = 'PAID' AND last_paid <= due)::int AS paid_on_time,
        COUNT(*) FILTER (WHERE due IS NOT NULL AND payment_status = 'PAID' AND last_paid > due)::int AS paid_late,
        ROUND(AVG(last_paid - due) FILTER (WHERE payment_status = 'PAID' AND last_paid > due), 1)::float8 AS avg_days_late,
        MAX(last_paid - due) FILTER (WHERE payment_status = 'PAID' AND last_paid > due)::int AS max_days_late,
        COALESCE(SUM(amount - paid_amount) FILTER (WHERE payment_status IN ('UNPAID', 'PARTIAL') AND amount > paid_amount), 0)::float8 AS debt,
        COALESCE(SUM(amount - paid_amount) FILTER (WHERE payment_status IN ('UNPAID', 'PARTIAL') AND amount > paid_amount AND due < ${TODAY}), 0)::float8 AS overdue_debt,
        COUNT(*) FILTER (WHERE payment_status IN ('UNPAID', 'PARTIAL') AND amount > paid_amount AND due < ${TODAY})::int AS overdue_deals,
        MAX(${TODAY} - due) FILTER (WHERE payment_status IN ('UNPAID', 'PARTIAL') AND amount > paid_amount AND due < ${TODAY})::int AS max_overdue_days
      FROM d`),
    prisma.clientNote.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { createdAt: true, content: true, user: { select: { fullName: true } } },
    }),
    prisma.$queryRaw<{ at: Date; manager: string | null; direction: string; status: string; talk_sec: number | null }[]>(Prisma.sql`
      SELECT cs.started_at AS at, u.full_name AS manager, cs.direction::text AS direction, cs.status::text AS status, cs.bill_sec AS talk_sec
      FROM call_sessions cs LEFT JOIN users u ON u.id = cs.manager_user_id
      WHERE cs.client_id = ${id} ORDER BY cs.started_at DESC LIMIT 10`),
    prisma.callAudit.findMany({
      where: { clientId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { createdAt: true, score: true, managerName: true, mentorTips: true },
    }),
    prisma.$queryRaw<{ deal_id: string; title: string; status: string; amount: number; created: string }[]>(Prisma.sql`
      SELECT d.id AS deal_id, d.title, d.status::text AS status, d.amount::float8 AS amount, to_char(d.created_at, 'YYYY-MM-DD') AS created
      FROM deals d WHERE d.client_id = ${id} AND d.is_archived = false AND d.status NOT IN ('CLOSED', 'CANCELED', 'REJECTED')
      ORDER BY d.created_at DESC LIMIT 10`),
    prisma.$queryRaw<{ title: string; status: string; created: string }[]>(Prisma.sql`
      SELECT title, status, to_char(created_at, 'YYYY-MM-DD') AS created FROM rop_task_plans
      WHERE items::text LIKE ${`%${id}%`} ORDER BY created_at DESC LIMIT 5`),
  ]);

  const pay = payments[0];
  const portrait = {
    profile: c.portrait_profile, goals: c.portrait_goals, pains: c.portrait_pains,
    fears: c.portrait_fears, objections: c.portrait_objections,
  };
  return {
    found: true,
    client: {
      client_id: c.id, name: c.company_name, contact: c.contact_name, phone: c.phone, inn: c.inn,
      relation: c.relation, relation_label: RELATION_LABELS[c.relation] ?? c.relation,
      manager: c.manager, vip: c.is_svip, credit_status: c.credit_status, archived: c.is_archived,
      in_crm_since: ymd(c.created_at),
    },
    portrait: Object.values(portrait).some(Boolean) ? portrait : null,
    purchases: { ...purchases[0], avg_check: purchases[0]?.deals ? Math.round(purchases[0].revenue_total / purchases[0].deals) : null },
    revenue_by_month_12m: monthly,
    top_products_12m: topProducts,
    payment_discipline: {
      ...pay,
      note: 'with_terms — сделки со сроком оплаты; paid_on_time/paid_late — оплаченные вовремя/позже срока (по дате последнего платежа); prepaid_or_no_terms — без срока (обычно предоплата).',
    },
    notes: notes.map((n) => ({ date: ymd(n.createdAt), author: n.user.fullName, text: n.content.slice(0, 500) })),
    calls: calls.map((k) => ({ date: ymd(k.at), manager: k.manager, direction: k.direction, status: k.status, talk_sec: k.talk_sec })),
    call_audits: audits.map((a) => ({ date: ymd(a.createdAt), score: a.score, manager: a.managerName, tips: a.mentorTips })),
    open_deals: openDeals,
    agent_plans: plans,
  };
}

// ─── Причины потерь ─────────────────────────────────────────────────────────

export const LOSS_REASONS = {
  price: 'цена',
  credit_terms: 'отсрочка / не даём в долг',
  quality: 'качество товара',
  availability: 'нет в наличии / сроки поставки',
  service: 'сервис, доставка, отношение',
  demand_drop: 'упал спрос / нет заказов / закрылись',
  contact_changed: 'сменился закупщик или ЛПР',
  other: 'другое',
  unclear: 'заметки есть, причина не ясна',
  no_info: 'менеджер не выяснял (заметок нет)',
} as const;
type LossReason = keyof typeof LOSS_REASONS;

type Classified = { reason: LossReason; went_to_competitor: boolean; competitor: string; detail: string; quote: string };

/** Классификация клиента живёт, пока не появилась новая заметка. */
const classifiedCache = new Map<string, { hash: string; result: Classified }>();

const CLASSIFY_PROMPT = `Ты разбираешь, почему клиенты оптовой компании (Ташкент, расходники для типографий) перестали покупать.
По каждому клиенту — заметки менеджеров. Определи ОДНУ главную причину из списка: ${Object.entries(LOSS_REASONS).filter(([k]) => k !== 'no_info').map(([k, v]) => `${k} (${v})`).join(', ')}.
«Ушёл к конкуренту» — не причина, а куда ушёл: отметь went_to_competitor=true и название, если есть, а причиной укажи почему (например, у конкурента отсрочка → credit_terms).
detail — одна короткая фраза своими словами, quote — дословная цитата из заметки (до 150 символов) или пустая строка.
Не выдумывай: если из заметок причина не следует — unclear.`;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    clients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          client_id: { type: 'string' },
          reason: { type: 'string', enum: Object.keys(LOSS_REASONS).filter((k) => k !== 'no_info') },
          went_to_competitor: { type: 'boolean' },
          competitor: { type: 'string' },
          detail: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['client_id', 'reason', 'went_to_competitor', 'competitor', 'detail', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['clients'],
  additionalProperties: false,
};

async function classify(items: { client_id: string; client: string; notes: { date: string | null; text: string }[] }[]) {
  const out = new Map<string, Classified>();
  if (!items.length || !config.claude.apiKey) return out;
  const client = new Anthropic({ apiKey: config.claude.apiKey });
  const response = await client.messages.create({
    model: config.ropAgent.digestModel,
    max_tokens: 16000,
    system: CLASSIFY_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: CLASSIFY_SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify(items) }],
  });
  if (response.stop_reason !== 'end_turn') return out;
  const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text) as { clients: (Classified & { client_id: string })[] };
  for (const { client_id, ...rest } of parsed.clients) out.set(client_id, rest);
  return out;
}

export async function lossReasons(input: { include_lost?: boolean; manager_id?: string; limit?: number }) {
  const limit = Math.min(Math.max(Math.round(input.limit ?? 40), 5), 80);
  const [overdue, lost] = await Promise.all([
    clientPurchaseCycles({ status: 'overdue', manager_id: input.manager_id, limit: 200 }),
    input.include_lost === false ? Promise.resolve({ clients: [] }) : clientPurchaseCycles({ status: 'lost', manager_id: input.manager_id, limit: 200 }),
  ]);
  const clients = [...overdue.clients, ...lost.clients]
    .sort((a, b) => b.revenue_12m - a.revenue_12m || b.revenue_total - a.revenue_total)
    .slice(0, limit);
  if (!clients.length) return { note: 'Пропавших и ушедших постоянных клиентов нет.', reasons: [], clients: [] };

  // Заметки начиная с месяца последней покупки: причину пишут, когда клиент затихает.
  // Если таких нет — берём последние, какие есть.
  const notes = await prisma.$queryRaw<{ client_id: string; id: string; created_at: Date; content: string; author: string }[]>(Prisma.sql`
    SELECT n.client_id, n.id, n.created_at, n.content, u.full_name AS author FROM (
      SELECT n.*, ROW_NUMBER() OVER (PARTITION BY n.client_id ORDER BY n.created_at DESC) AS rn
      FROM client_notes n
      WHERE n.deleted_at IS NULL AND n.client_id = ANY(${clients.map((c) => c.client_id)})
    ) n JOIN users u ON u.id = n.user_id
    WHERE n.rn <= 6`);
  const byClient = new Map<string, typeof notes>();
  for (const n of notes) byClient.set(n.client_id, [...(byClient.get(n.client_id) ?? []), n]);

  const results = new Map<string, Classified>();
  const toClassify: { client_id: string; client: string; notes: { date: string | null; text: string }[]; hash: string }[] = [];
  for (const c of clients) {
    const own = (byClient.get(c.client_id) ?? []).filter((n) => !c.last_order || ymd(n.created_at)! >= c.last_order.slice(0, 7));
    const list = own.length ? own : byClient.get(c.client_id) ?? [];
    if (!list.length) {
      results.set(c.client_id, { reason: 'no_info', went_to_competitor: false, competitor: '', detail: '', quote: '' });
      continue;
    }
    const hash = createHash('sha1').update(list.map((n) => n.id).join(',')).digest('hex');
    const cached = classifiedCache.get(c.client_id);
    if (cached?.hash === hash) {
      results.set(c.client_id, cached.result);
      continue;
    }
    toClassify.push({ client_id: c.client_id, client: c.client, hash, notes: list.map((n) => ({ date: ymd(n.created_at), text: n.content.slice(0, 500) })) });
  }

  let classifyError: string | null = null;
  try {
    const fresh = await classify(toClassify.map(({ hash: _h, ...rest }) => rest));
    for (const item of toClassify) {
      const r = fresh.get(item.client_id);
      if (!r) continue;
      results.set(item.client_id, r);
      classifiedCache.set(item.client_id, { hash: item.hash, result: r });
    }
  } catch (err) {
    classifyError = (err as Error).message;
  }
  // Без модели (нет ключа или сбой) — отдаём заметки как есть, агент разберёт сам.
  const rawNotes = toClassify.filter((i) => !results.has(i.client_id));

  const rows = clients.map((c) => {
    const r = results.get(c.client_id);
    return {
      client_id: c.client_id, client: c.client, manager: c.manager, status: c.status,
      revenue_12m: c.revenue_12m, revenue_total: c.revenue_total, days_since: c.days_since,
      reason: r?.reason ?? null, reason_label: r ? LOSS_REASONS[r.reason] : null,
      went_to_competitor: r?.went_to_competitor ?? null, competitor: r?.competitor || null,
      detail: r?.detail || null, quote: r?.quote || null,
    };
  });

  const reasons = (Object.keys(LOSS_REASONS) as LossReason[]).map((key) => {
    const list = rows.filter((r) => r.reason === key);
    return {
      reason: key,
      label: LOSS_REASONS[key],
      clients: list.length,
      revenue_12m: Math.round(list.reduce((s, r) => s + r.revenue_12m, 0)),
      revenue_total: Math.round(list.reduce((s, r) => s + r.revenue_total, 0)),
      went_to_competitor: list.filter((r) => r.went_to_competitor).length,
      examples: list.slice(0, 3).map((r) => ({ client: r.client, detail: r.detail, quote: r.quote })),
    };
  }).filter((r) => r.clients > 0).sort((a, b) => b.revenue_12m - a.revenue_12m);

  const noInfoByManager = Object.entries(rows.filter((r) => r.reason === 'no_info')
    .reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.manager]: (acc[r.manager] ?? 0) + 1 }), {}))
    .map(([manager, clients]) => ({ manager, clients })).sort((a, b) => b.clients - a.clients);

  return {
    note: 'Пропавшие (overdue) и давно ушедшие (lost) постоянные клиенты, самые ценные по выручке за год. Причина — по заметкам менеджеров. '
      + 'no_info — заметок нет: причину никто не выяснил, это отдельная проблема.',
    analyzed_clients: rows.length,
    reasons,
    no_info_by_manager: noInfoByManager,
    competitors: [...new Set(rows.map((r) => r.competitor).filter(Boolean))],
    clients: rows,
    ...(rawNotes.length ? {
      unclassified_notes: rawNotes.map(({ hash: _h, ...rest }) => rest),
      classify_error: classifyError ?? 'нет ключа Claude — классифицируй причины сам по заметкам',
    } : {}),
  };
}
