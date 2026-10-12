import { Prisma, type Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import {
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_ANALYTICS_LINE_REVENUE_DI,
} from '../../lib/analytics';
import { summarizeAttendance, workdaysInMonth, type AttendanceSummary } from '../../lib/attendanceMarks';
import type { UpsertEmployeeReviewDto } from './employee-cards.dto';

/**
 * Карточка сотрудника за месяц: автоматические показатели из CRM + оценка HR.
 *
 * Показатели не хранятся — считаются на лету из тех же таблиц, что KPI и
 * посещаемость, поэтому карточка всегда совпадает с ними.
 */

const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;

/** Админов HR не оценивает (и в «Сотрудниках» их не трогает). */
const CARD_ROLES: Role[] = [
  'OPERATOR', 'MANAGER', 'HR', 'ACCOUNTANT', 'FOREIGN_TRADE',
  'WAREHOUSE', 'WAREHOUSE_MANAGER', 'DRIVER', 'LOADER',
];

export type RoleGroup = 'sales' | 'operations' | 'office';

export function roleGroup(role: Role): RoleGroup {
  if (role === 'MANAGER' || role === 'OPERATOR') return 'sales';
  if (role === 'WAREHOUSE' || role === 'WAREHOUSE_MANAGER' || role === 'DRIVER' || role === 'LOADER') return 'operations';
  return 'office';
}

export const REVIEW_CRITERIA = ['discipline', 'quality', 'initiative', 'teamwork'] as const;

/** Средний балл по заполненным критериям (1–5); null — ни одного не поставили. */
export function hrReviewScore(r: Partial<Record<(typeof REVIEW_CRITERIA)[number], number | null>>): number | null {
  const vals = REVIEW_CRITERIA.map((k) => r[k]).filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
}

function monthBounds(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - TASHKENT_OFFSET),
    end: new Date(Date.UTC(year, month, 1) - TASHKENT_OFFSET),
    dateFrom: new Date(Date.UTC(year, month - 1, 1)),
    dateTo: new Date(Date.UTC(year, month, 1)),
  };
}

export function assertPeriod(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2099) throw new AppError(400, 'Некорректный год');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new AppError(400, 'Некорректный месяц');
}

const countMap = (rows: { id: string; n: string | number }[]) => new Map(rows.map((r) => [r.id, Number(r.n)]));

export interface EmployeeCardMetrics {
  userId: string;
  fullName: string;
  role: Role;
  department: string | null;
  group: RoleGroup;
  attendance: AttendanceSummary;
  tasks: { dueInMonth: number; done: number; overdueOpen: number };
  /** Действий в CRM за месяц (без входов и выходов) — видно, работает ли человек в системе. */
  crmActions: number;
  sales: {
    revenueFact: number;
    revenueTarget: number | null;
    planPercent: number | null;
    deals: number;
    contacts: number;
    callAudits: number;
    callScore: number | null;
  } | null;
  operations: {
    itemsConfirmed: number;
    shipments: number;
    loadings: number;
    deliveries: number;
  } | null;
  review: {
    id: string;
    discipline: number | null;
    quality: number | null;
    initiative: number | null;
    teamwork: number | null;
    praise: string | null;
    remarks: string | null;
    improve: string | null;
    score: number | null;
    reviewer: { id: string; fullName: string };
    updatedAt: Date;
  } | null;
}

/** Показатели за месяц по списку сотрудников — одним набором запросов на всех. */
async function computeMetrics(year: number, month: number, onlyUserId?: string): Promise<EmployeeCardMetrics[]> {
  const users = await prisma.user.findMany({
    where: onlyUserId ? { id: onlyUserId } : { isActive: true, role: { in: CARD_ROLES } },
    select: { id: true, fullName: true, role: true, department: true },
    orderBy: { fullName: 'asc' },
  });
  if (users.length === 0) return [];
  const ids = users.map((u) => u.id);
  const idList = Prisma.join(ids);
  const { start, end, dateFrom, dateTo } = monthBounds(year, month);
  const now = new Date();
  const overdueCut = now < end ? now : end;

  const [attendance, tasks, actionsRaw, revenueRaw, goals, notesRaw, boardRaw, auditsRaw, confirmedRaw, shipmentsRaw, loadingsRaw, deliveriesRaw, reviews] =
    await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { userId: { in: ids }, date: { gte: dateFrom, lt: dateTo } },
        select: { userId: true, checkIn: true, checkOut: true, marks: true },
      }),
      prisma.task.findMany({
        where: {
          assigneeId: { in: ids },
          OR: [
            { dueDate: { gte: start, lt: end } },
            { dueDate: { lt: overdueCut }, status: { in: ['TODO', 'IN_PROGRESS'] } },
          ],
        },
        select: { assigneeId: true, dueDate: true, status: true },
      }),
      prisma.$queryRaw<{ id: string; n: string }[]>(Prisma.sql`
        SELECT user_id AS id, COUNT(*)::text AS n FROM audit_logs
        WHERE created_at >= ${start} AND created_at < ${end}
          AND user_id IN (${idList})
          AND action NOT IN ('LOGIN', 'LOGOUT', 'LOGIN_FAILED')
        GROUP BY user_id`),
      prisma.$queryRaw<{ id: string; revenue: string; deals: string }[]>(Prisma.sql`
        SELECT d.manager_id AS id,
          COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text AS revenue,
          COUNT(DISTINCT d.id)::text AS deals
        FROM deal_items di JOIN deals d ON d.id = di.deal_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${start}
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} < ${end}
          AND d.manager_id IN (${idList})
        GROUP BY d.manager_id`),
      prisma.userMonthlyGoal.findMany({
        where: { userId: { in: ids }, year, month },
        select: { userId: true, revenueTarget: true },
      }),
      prisma.$queryRaw<{ id: string; n: string }[]>(Prisma.sql`
        SELECT user_id AS id, COUNT(*)::text AS n FROM client_notes
        WHERE deleted_at IS NULL AND created_at >= ${start} AND created_at < ${end}
          AND user_id IN (${idList})
        GROUP BY user_id`),
      prisma.$queryRaw<{ id: string; n: string }[]>(Prisma.sql`
        SELECT author_id AS id, COUNT(*)::text AS n FROM notes_board_rows
        WHERE last_call_at >= ${start} AND last_call_at < ${end}
          AND author_id IN (${idList})
        GROUP BY author_id`),
      prisma.callAudit.groupBy({
        by: ['managerId'],
        where: { managerId: { in: ids }, createdAt: { gte: start, lt: end } },
        _count: { _all: true },
        _avg: { score: true },
      }),
      prisma.$queryRaw<{ id: string; n: string }[]>(Prisma.sql`
        SELECT confirmed_by AS id, COUNT(*)::text AS n FROM deal_items
        WHERE confirmed_at >= ${start} AND confirmed_at < ${end}
          AND confirmed_by IN (${idList})
        GROUP BY confirmed_by`),
      prisma.$queryRaw<{ id: string; n: string }[]>(Prisma.sql`
        SELECT shipped_by AS id, COUNT(*)::text AS n FROM shipments
        WHERE shipped_at >= ${start} AND shipped_at < ${end}
          AND shipped_by IN (${idList})
        GROUP BY shipped_by`),
      prisma.$queryRaw<{ id: string; n: string }[]>(Prisma.sql`
        SELECT d.loading_assignee_id AS id, COUNT(DISTINCT d.id)::text AS n
        FROM deals d JOIN deal_items di ON di.deal_id = d.id
        WHERE di.shipped_at >= ${start} AND di.shipped_at < ${end}
          AND d.loading_assignee_id IN (${idList})
        GROUP BY d.loading_assignee_id`),
      prisma.$queryRaw<{ id: string; n: string }[]>(Prisma.sql`
        SELECT d.delivery_driver_id AS id, COUNT(DISTINCT d.id)::text AS n
        FROM deals d JOIN deal_items di ON di.deal_id = d.id
        WHERE di.delivered_at >= ${start} AND di.delivered_at < ${end}
          AND d.delivery_driver_id IN (${idList})
        GROUP BY d.delivery_driver_id`),
      prisma.employeeMonthlyReview.findMany({
        where: { userId: { in: ids }, year, month },
        include: { reviewer: { select: { id: true, fullName: true } } },
      }),
    ]);

  const workdays = workdaysInMonth(year, month);
  const actions = countMap(actionsRaw);
  const revenue = new Map(revenueRaw.map((r) => [r.id, r]));
  const goalMap = new Map(goals.map((g) => [g.userId, g]));
  const notes = countMap(notesRaw);
  const board = countMap(boardRaw);
  const audits = new Map(auditsRaw.map((a) => [a.managerId, a]));
  const confirmed = countMap(confirmedRaw);
  const shipments = countMap(shipmentsRaw);
  const loadings = countMap(loadingsRaw);
  const deliveries = countMap(deliveriesRaw);
  const reviewMap = new Map(reviews.map((r) => [r.userId, r]));

  return users.map((u) => {
    const group = roleGroup(u.role);

    const myTasks = tasks.filter((t) => t.assigneeId === u.id);
    const dueInMonth = myTasks.filter((t) => t.dueDate && t.dueDate >= start && t.dueDate < end);
    const isDone = (s: string) => s === 'DONE' || s === 'APPROVED';

    const rev = revenue.get(u.id);
    const revenueFact = rev ? Number(rev.revenue) : 0;
    const goal = goalMap.get(u.id);
    const revenueTarget = goal?.revenueTarget != null ? Number(goal.revenueTarget) : null;
    const audit = audits.get(u.id);

    const r = reviewMap.get(u.id);
    return {
      userId: u.id,
      fullName: u.fullName,
      role: u.role,
      department: u.department ?? null,
      group,
      attendance: summarizeAttendance(attendance.filter((a) => a.userId === u.id), workdays),
      tasks: {
        dueInMonth: dueInMonth.length,
        done: dueInMonth.filter((t) => isDone(t.status)).length,
        overdueOpen: myTasks.filter((t) => t.dueDate && t.dueDate < overdueCut && !isDone(t.status)).length,
      },
      crmActions: actions.get(u.id) ?? 0,
      sales: group === 'sales'
        ? {
            revenueFact,
            revenueTarget,
            planPercent: revenueTarget && revenueTarget > 0 ? revenueFact / revenueTarget : null,
            deals: rev ? Number(rev.deals) : 0,
            contacts: (notes.get(u.id) ?? 0) + (board.get(u.id) ?? 0),
            callAudits: audit?._count._all ?? 0,
            callScore: audit?._avg.score != null ? Math.round(audit._avg.score * 10) / 10 : null,
          }
        : null,
      operations: group === 'operations'
        ? {
            itemsConfirmed: confirmed.get(u.id) ?? 0,
            shipments: shipments.get(u.id) ?? 0,
            loadings: loadings.get(u.id) ?? 0,
            deliveries: deliveries.get(u.id) ?? 0,
          }
        : null,
      review: r
        ? {
            id: r.id,
            discipline: r.discipline,
            quality: r.quality,
            initiative: r.initiative,
            teamwork: r.teamwork,
            praise: r.praise,
            remarks: r.remarks,
            improve: r.improve,
            score: hrReviewScore(r),
            reviewer: r.reviewer,
            updatedAt: r.updatedAt,
          }
        : null,
    };
  });
}

export async function listEmployeeCards(year: number, month: number) {
  return computeMetrics(year, month);
}

const HISTORY_MONTHS = 6;

export async function getEmployeeCard(userId: string, year: number, month: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) throw new AppError(404, 'Сотрудник не найден');

  const periods: { year: number; month: number }[] = [];
  for (let i = 0; i < HISTORY_MONTHS; i++) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    periods.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const { dateFrom, dateTo } = monthBounds(year, month);

  const [months, days, legacyReviews] = await Promise.all([
    Promise.all(periods.map((p) => computeMetrics(p.year, p.month, userId).then((rows) => ({ ...p, metrics: rows[0] })))),
    // Плашки и комментарии посещаемости за выбранный месяц — их HR видит прямо в карточке.
    prisma.attendanceRecord.findMany({
      where: { userId, date: { gte: dateFrom, lt: dateTo } },
      select: { id: true, date: true, checkIn: true, checkOut: true, marks: true, note: true },
      orderBy: { date: 'asc' },
    }),
    // Старые оценки «Аудита сотрудников» (одна цифра за день) — только для истории.
    prisma.workerReview.findMany({
      where: { managerId: userId },
      select: { id: true, rating: true, comment: true, period: true, reviewer: { select: { fullName: true } } },
      orderBy: { period: 'desc' },
      take: 20,
    }),
  ]);

  return {
    card: months[0].metrics,
    attendanceDays: days,
    history: months
      .slice()
      .reverse()
      .map((m) => ({
        year: m.year,
        month: m.month,
        reviewScore: m.metrics.review?.score ?? null,
        onTime: m.metrics.attendance.onTime,
        workdays: m.metrics.attendance.workdays,
        late: m.metrics.attendance.late,
        absent: m.metrics.attendance.absent,
        planPercent: m.metrics.sales?.planPercent ?? null,
        overdueTasks: m.metrics.tasks.overdueOpen,
      })),
    legacyReviews,
  };
}

export async function upsertEmployeeReview(
  userId: string,
  dto: UpsertEmployeeReviewDto,
  reviewer: { userId: string; role: string },
) {
  assertPeriod(dto.year, dto.month);
  if (userId === reviewer.userId) throw new AppError(403, 'Свою карточку оценивает руководитель');
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!target) throw new AppError(404, 'Сотрудник не найден');
  if (!CARD_ROLES.includes(target.role)) throw new AppError(403, 'Администраторов в карточках не оценивают');

  const data = {
    discipline: dto.discipline ?? null,
    quality: dto.quality ?? null,
    initiative: dto.initiative ?? null,
    teamwork: dto.teamwork ?? null,
    praise: dto.praise?.trim() || null,
    remarks: dto.remarks?.trim() || null,
    improve: dto.improve?.trim() || null,
    reviewerId: reviewer.userId,
  };
  return prisma.employeeMonthlyReview.upsert({
    where: { userId_year_month: { userId, year: dto.year, month: dto.month } },
    create: { userId, year: dto.year, month: dto.month, ...data },
    update: data,
  });
}
