import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import {
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_EXCLUDE_INTERNAL_COMPANY_DEAL,
} from '../../lib/analytics';
import { clientPurchaseCycles, slowStock } from './rop-agent.analysis';
import { taskPlanResults } from './rop-agent.control';
import { activeMemories, memoryText } from './rop-agent.memory';
import { kpiForecast } from './rop-agent.kpi';

/**
 * Ежедневная сводка РОП-агента за прошедший день. Цифры считаются здесь, без модели;
 * Claude пишет только короткий блок «на что обратить внимание». Сводка хранится
 * (rop_daily_digests), чтобы страница открывалась мгновенно и была история.
 */

export type DigestData = {
  date: string;
  revenue: {
    day: number;
    prevDay: number;
    sameWeekdayLastWeek: number;
    mtd: number;
    prevMtd: number;
    daily: { day: string; revenue: number }[];
  };
  deals: {
    closedDay: number;
    newDay: number;
    pipeline: { status: string; count: number; amount: number }[];
  };
  managers: { id: string; name: string; revenueDay: number; revenueMtd: number; dealsMtd: number }[];
  debts: {
    total: number;
    overdue: number;
    overdueDeals: number;
    topDebtors: { clientId: string; client: string; manager: string | null; debt: number; overdueDebt: number; maxOverdueDays: number }[];
  };
  clients: {
    dueSoon: number;
    overdue: number;
    topOverdue: { clientId: string; client: string; manager: string; revenue12m: number; daysSince: number; cycleDays: number }[];
  };
  slowStock: {
    frozen: number;
    count: number;
    top: { productId: string; product: string; frozen: number; daysSinceSale: number | null }[];
  };
  /** Прогноз текущего месяца (может отсутствовать в старых сводках). */
  forecast?: {
    period: string;
    goal: number | null;
    fact: number;
    forecast: number;
    range: [number, number];
    forecastPct: number | null;
    behind: { manager: string; plan: number; forecastPct: number; gap: number }[];
  };
  plans: {
    planId: string;
    title: string;
    manager: string;
    verdict: string;
    touched: number;
    clients: number;
    overdue: boolean;
  }[];
};

// ─── Даты ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseYmd = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => ymd(new Date(parseYmd(s).getTime() + n * DAY_MS));

export function tashkentYesterday(): string {
  return addDays(ymd(new Date(Date.now() + 5 * 60 * 60 * 1000)), -1);
}

export function isValidDigestDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseYmd(s).getTime());
}

// ─── Сбор цифр ──────────────────────────────────────────────────────────────

const REVENUE_DAY = SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT;

async function revenueBlock(date: string): Promise<DigestData['revenue']> {
  const monthStart = `${date.slice(0, 8)}01`;
  const prevMonthStart = ymd(new Date(Date.UTC(parseYmd(monthStart).getUTCFullYear(), parseYmd(monthStart).getUTCMonth() - 1, 1)));
  const dayOfMonth = Number(date.slice(8, 10));
  // Тот же отрезок прошлого месяца: 1…N-е число, но не дальше конца месяца.
  const prevMonthEnd = addDays(monthStart, -1);
  const prevMtdEnd = [addDays(prevMonthStart, dayOfMonth - 1), prevMonthEnd].sort()[0];
  const from = [prevMonthStart, addDays(date, -29)].sort()[0];

  const rows = await prisma.$queryRaw<{ day: string; revenue: number }[]>(Prisma.sql`
    SELECT to_char(x.day, 'YYYY-MM-DD') AS day, SUM(x.revenue)::float8 AS revenue FROM (
      SELECT ${REVENUE_DAY} AS day, ${SQL_ANALYTICS_LINE_REVENUE_DI} AS revenue
      FROM deal_items di JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= (${from}::date - 2)::timestamp
    ) x
    WHERE x.day BETWEEN ${from}::date AND ${date}::date
    GROUP BY x.day`);
  const byDay = new Map(rows.map((r) => [r.day, r.revenue]));
  const sum = (a: string, b: string) => rows.filter((r) => r.day >= a && r.day <= b).reduce((s, r) => s + r.revenue, 0);

  const daily: { day: string; revenue: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(date, -i);
    daily.push({ day: d, revenue: byDay.get(d) ?? 0 });
  }
  return {
    day: byDay.get(date) ?? 0,
    prevDay: byDay.get(addDays(date, -1)) ?? 0,
    sameWeekdayLastWeek: byDay.get(addDays(date, -7)) ?? 0,
    mtd: sum(monthStart, date),
    prevMtd: sum(prevMonthStart, prevMtdEnd),
    daily,
  };
}

async function dealsBlock(date: string): Promise<DigestData['deals']> {
  const dayOf = (col: Prisma.Sql) => Prisma.sql`DATE((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')`;
  const [counts, pipeline] = await Promise.all([
    prisma.$queryRaw<{ closed: number; created: number }[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE d.status = 'CLOSED' AND ${dayOf(Prisma.sql`d.closed_at`)} = ${date}::date)::int AS closed,
        COUNT(*) FILTER (WHERE ${dayOf(Prisma.sql`d.created_at`)} = ${date}::date)::int AS created
      FROM deals d
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED') AND ${SQL_EXCLUDE_INTERNAL_COMPANY_DEAL}
        AND (d.closed_at >= (${date}::date - 2)::timestamp OR d.created_at >= (${date}::date - 2)::timestamp)`),
    prisma.$queryRaw<{ status: string; count: number; amount: number }[]>(Prisma.sql`
      SELECT d.status::text AS status, COUNT(*)::int AS count, COALESCE(SUM(d.amount), 0)::float8 AS amount
      FROM deals d
      WHERE d.is_archived = false AND d.status NOT IN ('CLOSED', 'CANCELED', 'REJECTED') AND ${SQL_EXCLUDE_INTERNAL_COMPANY_DEAL}
      GROUP BY d.status ORDER BY count DESC`),
  ]);
  return { closedDay: counts[0]?.closed ?? 0, newDay: counts[0]?.created ?? 0, pipeline };
}

async function managersBlock(date: string): Promise<DigestData['managers']> {
  const monthStart = `${date.slice(0, 8)}01`;
  return prisma.$queryRaw<DigestData['managers']>(Prisma.sql`
    SELECT u.id, u.full_name AS name,
      COALESCE(SUM(x.revenue) FILTER (WHERE x.day = ${date}::date), 0)::float8 AS "revenueDay",
      COALESCE(SUM(x.revenue), 0)::float8 AS "revenueMtd",
      COUNT(DISTINCT x.deal_id)::int AS "dealsMtd"
    FROM (
      SELECT d.manager_id, d.id AS deal_id, ${REVENUE_DAY} AS day, ${SQL_ANALYTICS_LINE_REVENUE_DI} AS revenue
      FROM deal_items di JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= (${monthStart}::date - 2)::timestamp
    ) x
    JOIN users u ON u.id = x.manager_id
    WHERE x.day BETWEEN ${monthStart}::date AND ${date}::date
    GROUP BY u.id, u.full_name
    ORDER BY "revenueMtd" DESC`);
}

/** Долги — как в отчёте «Просрочка оплат»: неоплаченный остаток открытых и закрытых сделок. */
async function debtsBlock(date: string): Promise<DigestData['debts']> {
  const base = Prisma.sql`
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN users u ON u.id = d.manager_id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND d.payment_status IN ('UNPAID', 'PARTIAL')
      AND (d.amount - d.paid_amount) > 0
      AND ${SQL_EXCLUDE_INTERNAL_COMPANY_DEAL}`;
  const overdueDays = Prisma.sql`(${date}::date - DATE((d.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'))`;
  const [totals, top] = await Promise.all([
    prisma.$queryRaw<{ total: number; overdue: number; overdue_deals: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::float8 AS total,
        COALESCE(SUM(d.amount - d.paid_amount) FILTER (WHERE d.due_date IS NOT NULL AND ${overdueDays} > 0), 0)::float8 AS overdue,
        COUNT(*) FILTER (WHERE d.due_date IS NOT NULL AND ${overdueDays} > 0)::int AS overdue_deals
      ${base}`),
    prisma.$queryRaw<DigestData['debts']['topDebtors']>(Prisma.sql`
      SELECT c.id AS "clientId", c.company_name AS client, MAX(u.full_name) AS manager,
        SUM(d.amount - d.paid_amount)::float8 AS debt,
        COALESCE(SUM(d.amount - d.paid_amount) FILTER (WHERE d.due_date IS NOT NULL AND ${overdueDays} > 0), 0)::float8 AS "overdueDebt",
        COALESCE(MAX(${overdueDays}) FILTER (WHERE d.due_date IS NOT NULL AND ${overdueDays} > 0), 0)::int AS "maxOverdueDays"
      ${base}
      GROUP BY c.id, c.company_name
      ORDER BY "overdueDebt" DESC, debt DESC
      LIMIT 7`),
  ]);
  return { total: totals[0]?.total ?? 0, overdue: totals[0]?.overdue ?? 0, overdueDeals: totals[0]?.overdue_deals ?? 0, topDebtors: top };
}

async function clientsBlock(): Promise<DigestData['clients']> {
  const [overdue, dueSoon] = await Promise.all([
    clientPurchaseCycles({ status: 'overdue', limit: 200 }),
    clientPurchaseCycles({ status: 'due_soon', limit: 200 }),
  ]);
  return {
    overdue: overdue.clients.length,
    dueSoon: dueSoon.clients.length,
    topOverdue: overdue.clients.slice(0, 7).map((c) => ({
      clientId: c.client_id, client: c.client, manager: c.manager,
      revenue12m: c.revenue_12m, daysSince: c.days_since, cycleDays: c.cycle_days,
    })),
  };
}

async function slowStockBlock(): Promise<DigestData['slowStock']> {
  const r = await slowStock({ limit: 100, buyers_per_product: 0 });
  return {
    frozen: r.products.reduce((s, p) => s + (p.frozen_by_purchase ?? 0), 0),
    count: r.products.length,
    top: r.products.slice(0, 5).map((p) => ({
      productId: p.product_id, product: p.product, frozen: p.frozen_by_purchase ?? 0, daysSinceSale: p.days_since_sale,
    })),
  };
}

async function plansBlock(): Promise<DigestData['plans']> {
  const r = await taskPlanResults({ days: 30 });
  return r.plans.flatMap((p) => p.items.map((i) => ({
    planId: p.planId,
    title: p.title,
    manager: i.managerName,
    verdict: i.verdict,
    touched: i.summary.touched,
    clients: i.summary.clients,
    overdue: i.overdue,
  })));
}

/** Прогноз месяца той даты, за которую сводка (1-го числа — это уже прошлый, закрытый месяц). */
async function forecastBlock(date: string): Promise<DigestData['forecast']> {
  const f = await kpiForecast({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
  if (!f.company) return undefined;
  return {
    period: f.period,
    goal: f.company.goal,
    fact: f.company.fact_mtd,
    forecast: f.company.forecast,
    range: f.company.forecast_range as [number, number],
    forecastPct: f.company.forecast_pct,
    behind: f.managers
      .filter((m) => m.plan && m.forecast_pct != null && m.forecast_pct < 90)
      .map((m) => ({ manager: m.manager, plan: m.plan!, forecastPct: m.forecast_pct!, gap: m.gap_to_plan ?? 0 })),
  };
}

export async function collectDigestData(date: string): Promise<DigestData> {
  const [revenue, deals, managers, debts, clients, slow, plans, forecast] = await Promise.all([
    revenueBlock(date), dealsBlock(date), managersBlock(date), debtsBlock(date),
    clientsBlock(), slowStockBlock(), plansBlock(),
    forecastBlock(date).catch((err) => { console.error('[rop-digest] forecast failed:', (err as Error).message); return undefined; }),
  ]);
  return { date, revenue, deals, managers, debts, clients, slowStock: slow, plans, forecast };
}

// ─── Комментарий агента ─────────────────────────────────────────────────────

const COMMENTARY_PROMPT = `Ты — РОП-агент компании Polygraph Business (Ташкент, расходники для типографий, деньги в сумах).
Тебе дают цифры утренней сводки за вчерашний день в JSON и память агента — действующие договорённости директора.
Учитывай память: не поднимай то, что директор уже решил или объяснил (например, клиент по договорённости платит в конце месяца). Напиши директору блок «На что обратить внимание сегодня»:
3–6 коротких пунктов, каждый начинается с «- ». Только то, что требует действия или заметно отличается от обычного:
провал или рост выручки, отставание от плана месяца по прогнозу (forecast), менеджер, который отстаёт, крупная просрочка долга, ценный клиент, который пропал,
замороженные деньги в складе, розданные задачи, которые не выполняются. В каждом пункте — имя или товар и цифра.
Суммы пиши коротко: «48,2 млн», «1,02 млрд». Не пересказывай всю сводку, без вступления и без заголовка.
Последней строкой, после пустой строки, — одно предложение: с чего начать день.`;

async function writeCommentary(data: DigestData): Promise<string | null> {
  if (!config.claude.apiKey) return null;
  try {
    const client = new Anthropic({ apiKey: config.claude.apiKey });
    const response = await client.messages.create({
      model: config.ropAgent.digestModel,
      max_tokens: 4000,
      system: COMMENTARY_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: `Память агента:\n${memoryText(await activeMemories())}\n\nСводка:\n${JSON.stringify(data)}` }],
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || null;
  } catch (err) {
    console.error('[rop-digest] commentary failed:', (err as Error).message);
    return null;
  }
}

// ─── Хранение ───────────────────────────────────────────────────────────────

/** Собирает (или пересобирает) сводку за день и сохраняет. */
export async function buildDigest(date: string) {
  if (!isValidDigestDate(date)) throw new AppError(400, 'Дата в формате YYYY-MM-DD');
  const data = await collectDigestData(date);
  const commentary = await writeCommentary(data);
  return prisma.ropDailyDigest.upsert({
    where: { date },
    create: { date, data: data as unknown as Prisma.InputJsonValue, commentary },
    update: { data: data as unknown as Prisma.InputJsonValue, commentary },
  });
}

export async function getDigest(date: string) {
  if (!isValidDigestDate(date)) throw new AppError(400, 'Дата в формате YYYY-MM-DD');
  const digest = await prisma.ropDailyDigest.findUnique({ where: { date } });
  if (!digest) throw new AppError(404, 'Сводки за этот день нет');
  return digest;
}

export function listDigests(limit = 60) {
  return prisma.ropDailyDigest.findMany({
    orderBy: { date: 'desc' },
    take: limit,
    select: { date: true, createdAt: true, sentAt: true },
  });
}

