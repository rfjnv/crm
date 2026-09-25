import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { DEFAULT_BONUS_SCHEME, parseBonusScheme, type BonusTier } from '../../lib/bonus';
import {
  INTERNAL_COMPANY_NAME,
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_EXCLUDE_INTERNAL_COMPANY_DEAL,
} from '../../lib/analytics';

/**
 * План и прогноз месяца. Выручка — по тем же правилам и границам месяца (Ташкент),
 * что в отчёте «KPI менеджеров», чтобы цифры совпадали.
 *
 * Прогноз = факт с начала месяца + ожидаемое на оставшиеся дни. Ожидаемое берём из
 * профиля по дням недели за последние 8 недель (сколько обычно продаётся в
 * понедельник, во вторник…): так выходные и «тяжёлые» дни учитываются сами. Для
 * сверки — темп: факт ÷ прошедшие дни × дней в месяце. Разброс между ними — вилка.
 */

const TASHKENT_OFFSET = 5 * 3600_000;
const DAY = 86_400_000;
const PROFILE_WEEKS = 8;

type Period = { year: number; month: number; start: Date; end: Date; daysInMonth: number };

function period(year?: number, month?: number): Period {
  const now = new Date(Date.now() + TASHKENT_OFFSET);
  const y = year ?? now.getUTCFullYear();
  const m = month ?? now.getUTCMonth() + 1;
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) throw new AppError(400, 'Некорректный месяц');
  return {
    year: y,
    month: m,
    start: new Date(Date.UTC(y, m - 1, 1) - TASHKENT_OFFSET),
    end: new Date(Date.UTC(y, m, 1) - TASHKENT_OFFSET),
    daysInMonth: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
}

function rateFor(tiers: BonusTier[], percent: number): number {
  let rate = 0;
  for (const t of [...tiers].sort((a, b) => a.fromPercent - b.fromPercent)) if (percent >= t.fromPercent) rate = t.rate;
  return rate;
}

const round = (v: number) => Math.round(v);
const pct = (fact: number, plan: number | null) => (plan ? Math.round((fact / plan) * 1000) / 10 : null);

type DayRow = { manager_id: string | null; day: string; revenue: number };

export async function kpiForecast(input: { year?: number; month?: number; manager_id?: string }) {
  const p = period(input.year, input.month);
  const nowUtc = Date.now();
  if (p.start.getTime() > nowUtc) throw new AppError(400, 'Этот месяц ещё не начался');
  const closed = p.end.getTime() <= nowUtc;
  // Сколько месяца прошло: доля текущего дня тоже считается.
  const elapsedDays = closed ? p.daysInMonth : (nowUtc - p.start.getTime()) / DAY;
  const todayTk = new Date(nowUtc + TASHKENT_OFFSET);
  const todayYmd = todayTk.toISOString().slice(0, 10);

  const profileFrom = new Date(Math.min(nowUtc, p.end.getTime()) - PROFILE_WEEKS * 7 * DAY);
  const dayExpr = Prisma.sql`to_char((${SQL_EFFECTIVE_REVENUE_ITEM_TS} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD')`;
  const managerFilter = input.manager_id ? Prisma.sql`AND d.manager_id = ${input.manager_id}` : Prisma.empty;

  const [rows, goals, settings, schemeRow, pipeline, dealsMtd] = await Promise.all([
    // Продажи по дням: и за месяц, и за 8 недель профиля — одним запросом.
    prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT d.manager_id, ${dayExpr} AS day, SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::float8 AS revenue
      FROM deal_items di JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${new Date(Math.min(profileFrom.getTime(), p.start.getTime()))}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${p.end}
        ${managerFilter}
      GROUP BY d.manager_id, 2`),
    prisma.userMonthlyGoal.findMany({
      where: { year: p.year, month: p.month, ...(input.manager_id ? { userId: input.manager_id } : {}) },
      select: { userId: true, revenueTarget: true, dealsTarget: true },
    }),
    prisma.companySettings.findUnique({ where: { id: 'singleton' }, select: { monthlyRevenueGoal: true } }).catch(() => null),
    prisma.bonusScheme.findUnique({ where: { id: 'singleton' } }).catch(() => null),
    // Открытые сделки — то, что ещё может закрыться в этом месяце.
    prisma.$queryRaw<{ manager_id: string; deals: number; amount: number }[]>(Prisma.sql`
      SELECT d.manager_id, COUNT(*)::int AS deals, COALESCE(SUM(d.amount), 0)::float8 AS amount
      FROM deals d
      WHERE d.is_archived = false AND d.status NOT IN ('CLOSED', 'CANCELED', 'REJECTED') AND d.is_session_deal = false
        AND ${SQL_EXCLUDE_INTERNAL_COMPANY_DEAL} ${managerFilter}
      GROUP BY d.manager_id`),
    prisma.$queryRaw<{ manager_id: string; deals: number }[]>(Prisma.sql`
      SELECT d.manager_id, COUNT(DISTINCT d.id)::int AS deals
      FROM deal_items di JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
        AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${p.start} AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${p.end}
        ${managerFilter}
      GROUP BY d.manager_id`),
  ]);
  const scheme = schemeRow ? parseBonusScheme(schemeRow) : DEFAULT_BONUS_SCHEME;

  const monthStartYmd = new Date(p.start.getTime() + TASHKENT_OFFSET).toISOString().slice(0, 10);
  const profileFromYmd = new Date(profileFrom.getTime() + TASHKENT_OFFSET).toISOString().slice(0, 10);
  // Остаток месяца: сегодня (что ещё не продано из обычного) и дни до конца.
  const remainingDays: { ymd: string; dow: number }[] = [];
  if (!closed) {
    for (let t = Date.UTC(todayTk.getUTCFullYear(), todayTk.getUTCMonth(), todayTk.getUTCDate()); ; t += DAY) {
      const d = new Date(t);
      if (d.getUTCMonth() + 1 !== p.month) break;
      remainingDays.push({ ymd: d.toISOString().slice(0, 10), dow: d.getUTCDay() });
    }
  }

  /** Прогноз по набору дневных продаж (одного менеджера или всей компании). */
  function forecastOf(days: DayRow[]) {
    const mtd = days.filter((r) => r.day >= monthStartYmd).reduce((s, r) => s + r.revenue, 0);
    const today = days.filter((r) => r.day === todayYmd).reduce((s, r) => s + r.revenue, 0);
    const byDow = Array.from({ length: 7 }, () => 0);
    for (const r of days) {
      if (r.day >= profileFromYmd && r.day < todayYmd) byDow[new Date(`${r.day}T00:00:00Z`).getUTCDay()] += r.revenue;
    }
    const dowAvg = byDow.map((v) => v / PROFILE_WEEKS);
    let rest = 0;
    for (const d of remainingDays) rest += d.ymd === todayYmd ? Math.max(0, dowAvg[d.dow] - today) : dowAvg[d.dow];
    const byProfile = mtd + rest;
    const byPace = closed ? mtd : (mtd / Math.max(elapsedDays, 1)) * p.daysInMonth;
    const workDaysLeft = remainingDays.filter((d) => dowAvg[d.dow] > 0).length;
    return {
      mtd,
      expected: closed ? mtd : byProfile,
      low: Math.min(byProfile, byPace),
      high: Math.max(byProfile, byPace),
      workDaysLeft,
      avgPerWorkDay: (() => {
        const worked = days.filter((r) => r.day >= monthStartYmd && r.revenue > 0).length;
        return worked ? mtd / worked : 0;
      })(),
    };
  }

  function planBlock(plan: number | null, f: ReturnType<typeof forecastOf>) {
    if (!plan) return { plan: null };
    const fcPct = (f.expected / plan) * 100;
    const next = [...scheme.tiers].sort((a, b) => a.fromPercent - b.fromPercent).find((t) => t.fromPercent > fcPct);
    const gap = Math.max(0, plan - f.expected);
    return {
      plan: round(plan),
      done_pct: pct(f.mtd, plan),
      forecast_pct: pct(f.expected, plan),
      gap_to_plan: round(gap),
      need_per_work_day: f.workDaysLeft ? round(Math.max(0, plan - f.mtd) / f.workDaysLeft) : null,
      bonus_rate_at_forecast: rateFor(scheme.tiers, fcPct),
      bonus_base_at_forecast: round((f.expected * rateFor(scheme.tiers, fcPct)) / 100),
      next_tier: next ? {
        from_percent: next.fromPercent,
        rate: next.rate,
        extra_sales_needed: round((plan * next.fromPercent) / 100 - f.expected),
        bonus_base_there: round(((plan * next.fromPercent) / 100) * next.rate / 100),
      } : null,
    };
  }

  const byManager = new Map<string, DayRow[]>();
  for (const r of rows) if (r.manager_id) byManager.set(r.manager_id, [...(byManager.get(r.manager_id) ?? []), r]);
  const goalBy = new Map(goals.map((g) => [g.userId, g]));
  const pipeBy = new Map(pipeline.map((x) => [x.manager_id, x]));
  const dealsBy = new Map(dealsMtd.map((x) => [x.manager_id, x.deals]));

  const managerIds = [...new Set([...byManager.keys(), ...goals.filter((g) => g.revenueTarget != null).map((g) => g.userId)])];
  const users = await prisma.user.findMany({
    where: { id: { in: managerIds }, OR: [{ companyId: null }, { company: { name: { not: INTERNAL_COMPANY_NAME } } }] },
    select: { id: true, fullName: true, isActive: true },
  });

  const managers = users.map((u) => {
    const f = forecastOf(byManager.get(u.id) ?? []);
    const goal = goalBy.get(u.id);
    const plan = goal?.revenueTarget != null ? Number(goal.revenueTarget) : null;
    return {
      manager_id: u.id,
      manager: u.fullName,
      active: u.isActive,
      fact_mtd: round(f.mtd),
      forecast: round(f.expected),
      forecast_range: [round(f.low), round(f.high)],
      avg_per_work_day: round(f.avgPerWorkDay),
      deals_mtd: dealsBy.get(u.id) ?? 0,
      deals_target: goal?.dealsTarget ?? null,
      open_pipeline: { deals: pipeBy.get(u.id)?.deals ?? 0, amount: round(pipeBy.get(u.id)?.amount ?? 0) },
      ...planBlock(plan, f),
    };
  }).filter((m) => m.active || m.fact_mtd > 0)
    .sort((a, b) => (a.forecast_pct ?? 999) - (b.forecast_pct ?? 999));

  const company = forecastOf(input.manager_id ? [] : rows.map((r) => ({ ...r, manager_id: null })));
  const companyGoal = settings?.monthlyRevenueGoal ?? null;

  return {
    period: `${p.year}-${String(p.month).padStart(2, '0')}`,
    closed,
    days_passed: Math.floor(elapsedDays),
    days_in_month: p.daysInMonth,
    method: 'forecast = факт + ожидаемое по профилю дней недели за 8 недель; forecast_range — вилка между профилем и простым темпом. '
      + 'bonus_* — только база бонуса (ставка ступени × выручка), до умножения на критерии. Планы — из «KPI менеджеров» (цель по выручке на месяц).',
    ...(input.manager_id ? {} : {
      company: {
        fact_mtd: round(company.mtd),
        forecast: round(company.expected),
        forecast_range: [round(company.low), round(company.high)],
        goal: companyGoal,
        forecast_pct: pct(company.expected, companyGoal),
        gap_to_goal: companyGoal ? round(Math.max(0, companyGoal - company.expected)) : null,
        need_per_work_day: companyGoal && company.workDaysLeft ? round(Math.max(0, companyGoal - company.mtd) / company.workDaysLeft) : null,
        avg_per_work_day: round(company.avgPerWorkDay),
        work_days_left: company.workDaysLeft,
        open_pipeline: { deals: pipeline.reduce((s, x) => s + x.deals, 0), amount: round(pipeline.reduce((s, x) => s + x.amount, 0)) },
        managers_without_plan: managers.filter((m) => m.plan == null).map((m) => m.manager),
      },
    }),
    managers,
  };
}
