import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import {
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
} from '../../lib/analytics';
import type { PlanItem } from './rop-agent.plans';

/**
 * Контроль розданных планов: что менеджер реально сделал по каждому клиенту после
 * раздачи — звонки из телефонии, заметки, новые сделки и выручка, галочка в чек-листе.
 * Галочку сверяем со следами: «отмечен, но ни разговора, ни заметки» — повод спросить.
 * Недозвон — попытка, отработкой не считается.
 */

export type ClientProgress = {
  clientId: string;
  name: string;
  taskId: string | null;
  checked: boolean | null;
  /** Звонки менеджера клиенту (из телефонии) и сколько из них с разговором. */
  calls: number;
  answeredCalls: number;
  talkSec: number;
  /** Заметки менеджера по клиенту и последняя из них. */
  notes: number;
  lastNote: string | null;
  /** Касания других сотрудников — может, клиент ушёл к коллеге. */
  otherContacts: number;
  lastContactAt: string | null;
  dealsCreated: number;
  revenue: number;
  /** Отработан: был разговор (звонок с ненулевой длительностью) или заметка менеджера. */
  touched: boolean;
  /** Звонил, но не дозвонился и заметки нет — попытка, а не отработка. */
  attempted: boolean;
  /** Отмечен в чек-листе, но ни разговора, ни заметки после раздачи. */
  checkedWithoutTrace: boolean;
};

export type Verdict = 'ok' | 'in_progress' | 'behind' | 'no_touch';

export type ItemProgress = {
  key: string;
  managerId: string;
  managerName: string;
  title: string;
  dueDate: string | null;
  overdue: boolean;
  taskStatuses: string[];
  reports: string[];
  clients: ClientProgress[];
  summary: {
    clients: number;
    touched: number;
    attempted: number;
    checked: number;
    withDeal: number;
    revenue: number;
    checkedWithoutTrace: number;
  };
  verdict: Verdict;
};

export type PlanProgress = {
  planId: string;
  title: string;
  assignedAt: string;
  daysSinceAssigned: number;
  items: ItemProgress[];
  totals: ItemProgress['summary'];
};

type ChecklistItem = { text: string; checked: boolean };

const DONE_STATUSES = new Set(['DONE', 'APPROVED']);

function tashkentToday(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Галочка клиента в чек-листе. Пункты создавались по порядку клиентов, но менеджер
 * мог переписать чек-лист, поэтому ищем пункт, начинающийся с имени клиента, а
 * порядок берём только как запасной вариант.
 */
function checkedFor(checklist: ChecklistItem[], name: string, index: number): boolean | null {
  const byName = checklist.find((c) => c.text.trim().toLowerCase().startsWith(name.trim().toLowerCase()));
  if (byName) return byName.checked;
  return checklist[index]?.checked ?? null;
}

function verdictOf(s: ItemProgress['summary'], overdue: boolean, allDone: boolean, days: number): Verdict {
  if (s.clients === 0) return allDone ? 'ok' : overdue ? 'behind' : 'in_progress';
  const share = s.touched / s.clients;
  if (share >= 0.8 && (allDone || !overdue)) return 'ok';
  if (s.touched === 0 && (overdue || days >= 2)) return 'no_touch';
  if (overdue) return 'behind';
  return 'in_progress';
}

export async function computePlanProgress(plan: { id: string; title: string; items: Prisma.JsonValue; assignedAt: Date | null }): Promise<PlanProgress> {
  if (!plan.assignedAt) throw new AppError(409, 'План ещё не роздан');
  const since = plan.assignedAt;
  const items = plan.items as unknown as PlanItem[];

  const pairs = items.flatMap((i) => i.clients.map((c) => ({ clientId: c.clientId, managerId: i.managerId })));
  const taskIds = [...new Set(items.flatMap((i) => i.taskIds ?? []))];

  const [facts, tasks] = await Promise.all([
    pairs.length ? prisma.$queryRaw<{
      client_id: string; calls: number; answered: number; talk_sec: number; notes: number; last_note: string | null;
      other: number; last_contact_at: string | null; deals_created: number; revenue: number;
    }[]>(Prisma.sql`
      WITH pairs AS (
        SELECT * FROM unnest(${pairs.map((p) => p.clientId)}::text[], ${pairs.map((p) => p.managerId)}::text[]) AS t(client_id, manager_id)
      ),
      n AS (
        SELECT p.client_id,
          COUNT(*) FILTER (WHERE x.user_id = p.manager_id)::int AS mine,
          COUNT(*) FILTER (WHERE x.user_id <> p.manager_id)::int AS other,
          MAX(x.created_at) FILTER (WHERE x.user_id = p.manager_id) AS last_mine,
          (array_agg(x.content ORDER BY x.created_at DESC) FILTER (WHERE x.user_id = p.manager_id))[1] AS last_note
        FROM pairs p JOIN client_notes x ON x.client_id = p.client_id AND x.deleted_at IS NULL AND x.created_at >= ${since}
        GROUP BY p.client_id
      ),
      c AS (
        SELECT p.client_id,
          COUNT(*) FILTER (WHERE x.manager_user_id = p.manager_id)::int AS calls,
          COUNT(*) FILTER (WHERE x.manager_user_id = p.manager_id AND COALESCE(x.bill_sec, 0) > 0)::int AS answered,
          COALESCE(SUM(x.bill_sec) FILTER (WHERE x.manager_user_id = p.manager_id), 0)::int AS talk_sec,
          COUNT(*) FILTER (WHERE x.manager_user_id IS DISTINCT FROM p.manager_id)::int AS other,
          MAX(x.started_at) FILTER (WHERE x.manager_user_id = p.manager_id) AS last_mine
        FROM pairs p JOIN call_sessions x ON x.client_id = p.client_id AND x.started_at >= ${since}
        GROUP BY p.client_id
      ),
      d AS (
        SELECT p.client_id, COUNT(DISTINCT x.id)::int AS deals_created
        FROM pairs p JOIN deals x ON x.client_id = p.client_id AND x.created_at >= ${since}
          AND x.is_archived = false AND x.status NOT IN ('CANCELED', 'REJECTED')
        GROUP BY p.client_id
      ),
      r AS (
        SELECT d.client_id, SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::float8 AS revenue
        FROM deal_items di JOIN deals d ON d.id = di.deal_id
        WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND d.client_id IN (SELECT client_id FROM pairs)
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${since}
        GROUP BY d.client_id
      )
      SELECT p.client_id,
        COALESCE(c.calls, 0) AS calls, COALESCE(c.answered, 0) AS answered, COALESCE(c.talk_sec, 0) AS talk_sec,
        COALESCE(n.mine, 0) AS notes, LEFT(n.last_note, 300) AS last_note,
        (COALESCE(n.other, 0) + COALESCE(c.other, 0))::int AS other,
        to_char(GREATEST(n.last_mine, c.last_mine) AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD HH24:MI') AS last_contact_at,
        COALESCE(d.deals_created, 0) AS deals_created,
        COALESCE(r.revenue, 0)::float8 AS revenue
      FROM pairs p
      LEFT JOIN n ON n.client_id = p.client_id
      LEFT JOIN c ON c.client_id = p.client_id
      LEFT JOIN d ON d.client_id = p.client_id
      LEFT JOIN r ON r.client_id = p.client_id`) : Promise.resolve([]),
    prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, status: true, checklist: true, report: true },
    }),
  ]);

  const factByClient = new Map(facts.map((f) => [f.client_id, f]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const today = tashkentToday();
  const days = Math.floor((Date.now() - since.getTime()) / 86_400_000);

  const progressItems = items.map((item): ItemProgress => {
    const itemTasks = (item.taskIds ?? []).map((id) => taskById.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
    const allDone = itemTasks.length > 0 && itemTasks.every((t) => DONE_STATUSES.has(t.status));

    // Индекс клиента внутри своей задачи — для сопоставления с чек-листом по порядку.
    const indexInTask = new Map<string, number>();
    const clients = item.clients.map((c): ClientProgress => {
      const f = factByClient.get(c.clientId);
      const task = c.taskId ? taskById.get(c.taskId) : undefined;
      const idx = indexInTask.get(c.taskId ?? '') ?? 0;
      indexInTask.set(c.taskId ?? '', idx + 1);
      const checklist = (Array.isArray(task?.checklist) ? task!.checklist : []) as unknown as ChecklistItem[];
      const checked = task ? checkedFor(checklist, c.name, idx) : null;
      const calls = f?.calls ?? 0;
      const answeredCalls = f?.answered ?? 0;
      const notes = f?.notes ?? 0;
      const touched = answeredCalls > 0 || notes > 0;
      return {
        clientId: c.clientId,
        name: c.name,
        taskId: c.taskId ?? null,
        checked,
        calls,
        answeredCalls,
        talkSec: f?.talk_sec ?? 0,
        notes,
        lastNote: f?.last_note ?? null,
        otherContacts: f?.other ?? 0,
        lastContactAt: f?.last_contact_at ?? null,
        dealsCreated: f?.deals_created ?? 0,
        revenue: f?.revenue ?? 0,
        touched,
        attempted: !touched && calls > 0,
        checkedWithoutTrace: checked === true && !touched,
      };
    });

    const summary = {
      clients: clients.length,
      touched: clients.filter((c) => c.touched).length,
      attempted: clients.filter((c) => c.attempted).length,
      checked: clients.filter((c) => c.checked).length,
      withDeal: clients.filter((c) => c.dealsCreated > 0 || c.revenue > 0).length,
      revenue: clients.reduce((s, c) => s + c.revenue, 0),
      checkedWithoutTrace: clients.filter((c) => c.checkedWithoutTrace).length,
    };
    const overdue = !!item.dueDate && item.dueDate < today && !allDone;
    return {
      key: item.key,
      managerId: item.managerId,
      managerName: item.managerName,
      title: item.title,
      dueDate: item.dueDate,
      overdue,
      taskStatuses: itemTasks.map((t) => t.status),
      reports: itemTasks.map((t) => t.report?.trim()).filter((r): r is string => !!r),
      clients,
      summary,
      verdict: verdictOf(summary, overdue, allDone, days),
    };
  });

  const totals = progressItems.reduce((acc, i) => ({
    clients: acc.clients + i.summary.clients,
    touched: acc.touched + i.summary.touched,
    attempted: acc.attempted + i.summary.attempted,
    checked: acc.checked + i.summary.checked,
    withDeal: acc.withDeal + i.summary.withDeal,
    revenue: acc.revenue + i.summary.revenue,
    checkedWithoutTrace: acc.checkedWithoutTrace + i.summary.checkedWithoutTrace,
  }), { clients: 0, touched: 0, attempted: 0, checked: 0, withDeal: 0, revenue: 0, checkedWithoutTrace: 0 });

  return {
    planId: plan.id,
    title: plan.title,
    assignedAt: since.toISOString(),
    daysSinceAssigned: days,
    items: progressItems,
    totals,
  };
}

/** Прогресс одного плана для карточки на странице. */
export async function getPlanProgress(planId: string, userId: string) {
  const plan = await prisma.ropTaskPlan.findUnique({ where: { id: planId }, include: { chat: { select: { userId: true } } } });
  if (!plan || plan.chat.userId !== userId) throw new AppError(404, 'План не найден');
  return computePlanProgress(plan);
}

/**
 * Инструмент task_plan_results: розданные планы за последние дни (или один план)
 * с итогом по менеджерам и по каждому клиенту. Смотрит все розданные планы, а не
 * только из этого чата: директор и администратор контролируют одно и то же.
 */
export async function taskPlanResults(input: { plan_id?: string; days?: number }) {
  const days = Math.min(Math.max(Math.round(input.days ?? 45), 1), 365);
  const plans = await prisma.ropTaskPlan.findMany({
    where: input.plan_id
      ? { id: input.plan_id, status: 'ASSIGNED' }
      : { status: 'ASSIGNED', assignedAt: { gte: new Date(Date.now() - days * 86_400_000) } },
    orderBy: { assignedAt: 'desc' },
    take: 20,
  });
  if (input.plan_id && !plans.length) throw new AppError(404, 'Розданный план с таким id не найден');
  const progress = await Promise.all(plans.map(computePlanProgress));
  return {
    note: 'Факты — после момента раздачи. touched — был разговор менеджера с клиентом (звонок с длительностью) или его заметка. '
      + 'attempted — звонил, но не дозвонился. checkedWithoutTrace — отмечен в чек-листе без разговора и заметки. '
      + 'otherContacts — касания других сотрудников. '
      + 'verdict: ok — отработано ≥80%; in_progress — срок не вышел; behind — срок вышел, отработано меньше 80%; no_touch — ни одного касания.',
    plans: progress.map((p) => ({
      ...p,
      items: p.items.map((i) => ({
        ...i,
        // Для модели имена короче, чем полные объекты.
        clients: i.clients.map((c) => ({
          client: c.name, checked: c.checked, calls: c.calls, answered: c.answeredCalls, talk_min: Math.round(c.talkSec / 60),
          notes: c.notes, last_note: c.lastNote, other_contacts: c.otherContacts, last_contact_at: c.lastContactAt,
          deals: c.dealsCreated, revenue: c.revenue, attempted: c.attempted, checked_without_trace: c.checkedWithoutTrace,
        })),
      })),
    })),
  };
}
