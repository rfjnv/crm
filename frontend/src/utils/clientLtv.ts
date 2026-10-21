/**
 * LTV клиентов: сколько клиент принёс за всё время, как часто покупает и не пора ли
 * ему напомнить о себе. Считается из помесячной выручки клиента.
 */

export interface LtvClientInput {
  id: string;
  companyName: string;
  managerName: string | null;
  firstAt: string;
  lastAt: string;
  deals: number;
}

export interface LtvMonthRow {
  clientId: string;
  year: number;
  month: number;
  revenue: number;
  deals: number;
}

/** Активный — покупал за 90 дней; засыпает — 91–180; ушёл — больше 180. */
export type ClientStatus = 'active' | 'cooling' | 'lost';

export const STATUS_DAYS = { active: 90, cooling: 180 } as const;

export interface ClientLtvStats {
  id: string;
  name: string;
  manager: string | null;
  firstAt: Date;
  lastAt: Date;
  /** Год первой покупки — когорта клиента. */
  cohort: number;
  ltv: number;
  deals: number;
  avgCheck: number;
  /** Месяцев от первой до последней покупки, включая оба. */
  lifetimeMonths: number;
  daysSinceLast: number;
  /** Обычный промежуток между покупками; null — покупка была одна. */
  avgIntervalDays: number | null;
  status: ClientStatus;
  /** Не покупает заметно дольше своего обычного промежутка — пора напомнить. */
  overdue: boolean;
  last12: number;
  prev12: number;
  /** Последние 12 месяцев к предыдущим 12; null — сравнивать не с чем. */
  trend12: number | null;
}

const DAY = 86_400_000;

export function clientStatus(daysSinceLast: number): ClientStatus {
  if (daysSinceLast <= STATUS_DAYS.active) return 'active';
  if (daysSinceLast <= STATUS_DAYS.cooling) return 'cooling';
  return 'lost';
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function computeClientStats(clients: LtvClientInput[], rows: LtvMonthRow[], now: Date): ClientLtvStats[] {
  const nowIdx = monthIndex(now.getFullYear(), now.getMonth() + 1);
  const byClient = new Map<string, { ltv: number; last12: number; prev12: number }>();
  for (const r of rows) {
    const acc = byClient.get(r.clientId) ?? { ltv: 0, last12: 0, prev12: 0 };
    acc.ltv += r.revenue;
    const age = nowIdx - monthIndex(r.year, r.month);
    if (age >= 0 && age < 12) acc.last12 += r.revenue;
    else if (age >= 12 && age < 24) acc.prev12 += r.revenue;
    byClient.set(r.clientId, acc);
  }

  return clients.map((c) => {
    const firstAt = new Date(c.firstAt);
    const lastAt = new Date(c.lastAt);
    const sums = byClient.get(c.id) ?? { ltv: 0, last12: 0, prev12: 0 };
    const daysSinceLast = Math.max(0, Math.floor((now.getTime() - lastAt.getTime()) / DAY));
    const spanDays = Math.max(0, (lastAt.getTime() - firstAt.getTime()) / DAY);
    const avgIntervalDays = c.deals > 1 ? Math.round(spanDays / (c.deals - 1)) : null;
    const status = clientStatus(daysSinceLast);
    return {
      id: c.id,
      name: c.companyName,
      manager: c.managerName,
      firstAt,
      lastAt,
      cohort: firstAt.getFullYear(),
      ltv: sums.ltv,
      deals: c.deals,
      avgCheck: c.deals > 0 ? sums.ltv / c.deals : 0,
      lifetimeMonths: monthIndex(lastAt.getFullYear(), lastAt.getMonth() + 1)
        - monthIndex(firstAt.getFullYear(), firstAt.getMonth() + 1) + 1,
      daysSinceLast,
      avgIntervalDays,
      status,
      // Ушедших не «напоминаем» — это уже другая работа; ждём хотя бы месяц
      overdue: status !== 'lost' && avgIntervalDays != null && daysSinceLast > Math.max(30, avgIntervalDays * 1.5),
      last12: sums.last12,
      prev12: sums.prev12,
      trend12: sums.prev12 > 0 ? sums.last12 / sums.prev12 - 1 : null,
    };
  });
}

/** Доля выручки, которую дают `fraction` самых крупных клиентов (правило Парето). */
export function topShare(values: number[], fraction = 0.2): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => b - a);
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;
  const n = Math.max(1, Math.round(sorted.length * fraction));
  return sorted.slice(0, n).reduce((s, v) => s + v, 0) / total;
}

export function median(values: number[]): number {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Выручка по годам в разрезе когорт (год первой покупки): видно, сколько приносят
 * давние клиенты и сколько — пришедшие в этом году.
 */
export function cohortRevenue(stats: ClientLtvStats[], rows: LtvMonthRow[]): Map<number, Map<number, number>> {
  const cohortOf = new Map(stats.map((s) => [s.id, s.cohort]));
  const out = new Map<number, Map<number, number>>();
  for (const r of rows) {
    const cohort = cohortOf.get(r.clientId);
    if (cohort == null) continue;
    const byYear = out.get(cohort) ?? new Map<number, number>();
    byYear.set(r.year, (byYear.get(r.year) ?? 0) + r.revenue);
    out.set(cohort, byYear);
  }
  return out;
}
