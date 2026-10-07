import { Prisma, TaskStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { notifyTasksAssigned } from '../tasks/tasks.notify';
import type { PlanItem } from './rop-agent.plans';

/**
 * Задачи CRM для РОП-агента: найти (list_tasks) и подготовить изменение
 * (propose_task_changes) — закрыть, удалить, перенести срок, передать другому.
 * Сам агент ничего не меняет: изменение сохраняется черновиком, а выполняет его
 * директор или админ кнопкой «Выполнить» (в Telegram или в CRM).
 */

export type TaskActionKind = 'close' | 'delete' | 'set_due_date' | 'reassign';

const ACTION_LABEL: Record<TaskActionKind, string> = {
  close: 'закрыть',
  delete: 'удалить',
  set_due_date: 'перенести срок',
  reassign: 'передать',
};

const MAX_TASKS = 300;

/** «1 задачу», «3 задачи», «5 задач». */
function tasksWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'задачу';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'задачи';
  return 'задач';
}
const OPEN: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
/** Граница дня по Ташкенту: «до 02.10» — всё, что раньше 02.10 00:00. */
const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:00`);
const tkDate = (d: Date | null) => (d ? new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10) : null);

/** id задач, которые создал агент (из розданных планов). */
async function agentTaskIds(): Promise<Set<string>> {
  const plans = await prisma.ropTaskPlan.findMany({ where: { status: 'ASSIGNED' }, select: { items: true } });
  return new Set(plans.flatMap((p) => (p.items as unknown as PlanItem[]).flatMap((i) => i.taskIds ?? [])));
}

// ─── Поиск ──────────────────────────────────────────────────────────────────

export type ListTasksInput = {
  assignee_id?: string;
  statuses?: string[];
  due_before?: string;
  due_after?: string;
  created_before?: string;
  created_after?: string;
  only_agent_tasks?: boolean;
  search?: string;
  limit?: number;
};

export async function listTasks(input: ListTasksInput) {
  const statuses = (input.statuses ?? []).filter((s): s is TaskStatus => (Object.values(TaskStatus) as string[]).includes(s));
  const limit = Math.min(Math.max(Math.round(input.limit ?? 100), 1), MAX_TASKS);
  const where: Prisma.TaskWhereInput = {
    status: { in: statuses.length ? statuses : OPEN },
    ...(input.assignee_id ? { assigneeId: input.assignee_id } : {}),
    ...(input.search?.trim() ? { title: { contains: input.search.trim(), mode: 'insensitive' } } : {}),
  };
  const due: Prisma.DateTimeNullableFilter = {};
  if (isYmd(input.due_before)) due.lt = dayStart(input.due_before);
  if (isYmd(input.due_after)) due.gte = dayStart(input.due_after);
  if (Object.keys(due).length) where.dueDate = due;
  const created: Prisma.DateTimeFilter = {};
  if (isYmd(input.created_before)) created.lt = dayStart(input.created_before);
  if (isYmd(input.created_after)) created.gte = dayStart(input.created_after);
  if (Object.keys(created).length) where.createdAt = created;

  const fromAgent = await agentTaskIds();
  if (input.only_agent_tasks) where.id = { in: [...fromAgent] };

  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true, title: true, status: true, dueDate: true, createdAt: true, checklist: true, report: true,
        assignee: { select: { fullName: true } },
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);
  const byStatus = await prisma.task.groupBy({ by: ['status'], where, _count: true });
  return {
    note: 'Статусы: TODO — к выполнению, IN_PROGRESS — в работе, DONE — сделана, ждёт одобрения, APPROVED — закрыта. '
      + 'Без statuses показываются незакрытые (TODO, IN_PROGRESS, DONE). Даты фильтров — по Ташкенту, «before» не включает сам день.',
    total,
    by_status: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    shown: tasks.length,
    tasks: tasks.map((t) => {
      const checklist = (Array.isArray(t.checklist) ? t.checklist : []) as { checked?: boolean }[];
      return {
        id: t.id,
        title: t.title.slice(0, 120),
        status: t.status,
        assignee: t.assignee.fullName,
        created_by: t.createdBy.fullName,
        from_agent: fromAgent.has(t.id),
        due_date: tkDate(t.dueDate),
        created_at: tkDate(t.createdAt),
        checklist: checklist.length ? `${checklist.filter((c) => c.checked).length}/${checklist.length}` : null,
        has_report: !!t.report?.trim(),
      };
    }),
  };
}

// ─── Черновик изменения ─────────────────────────────────────────────────────

export async function proposeTaskChanges(
  ctx: { chatId: string; userId: string },
  input: { action?: unknown; task_ids?: unknown; due_date?: unknown; assignee_id?: unknown; note?: unknown },
) {
  const action = input.action as TaskActionKind;
  if (!ACTION_LABEL[action]) throw new AppError(400, 'action: close, delete, set_due_date или reassign');
  const ids = [...new Set((Array.isArray(input.task_ids) ? input.task_ids : []).filter((x): x is string => typeof x === 'string'))];
  if (!ids.length) throw new AppError(400, 'Нужен список task_ids (найди их через list_tasks)');
  if (ids.length > MAX_TASKS) throw new AppError(400, `Не больше ${MAX_TASKS} задач за раз`);

  const params: Record<string, string> = {};
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
  if (note) params.note = note;
  let target = '';
  if (action === 'set_due_date') {
    if (!isYmd(input.due_date)) throw new AppError(400, 'Для переноса нужен due_date (YYYY-MM-DD)');
    params.dueDate = input.due_date;
    target = ` на ${input.due_date.split('-').reverse().join('.')}`;
  }
  if (action === 'reassign') {
    const user = typeof input.assignee_id === 'string'
      ? await prisma.user.findFirst({ where: { id: input.assignee_id, isActive: true }, select: { id: true, fullName: true } })
      : null;
    if (!user) throw new AppError(400, 'Для передачи нужен assignee_id активного сотрудника');
    params.assigneeId = user.id;
    target = ` → ${user.fullName}`;
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, status: true, assignee: { select: { fullName: true } } },
  });
  const missing = ids.length - tasks.length;
  // Закрывать уже закрытые незачем.
  const affected = action === 'close' ? tasks.filter((t) => t.status !== 'APPROVED') : tasks;
  if (!affected.length) throw new AppError(400, 'Подходящих задач не нашлось: их нет или они уже закрыты');

  const perPerson = new Map<string, number>();
  for (const t of affected) perPerson.set(t.assignee.fullName, (perPerson.get(t.assignee.fullName) ?? 0) + 1);
  const summary = `${ACTION_LABEL[action][0].toUpperCase()}${ACTION_LABEL[action].slice(1)} ${affected.length} ${tasksWord(affected.length)}${target}: `
    + [...perPerson].map(([name, n]) => `${name} — ${n}`).join(', ')
    + (note ? `. ${note}` : '');

  const row = await prisma.ropTaskAction.create({
    data: {
      chatId: ctx.chatId,
      action,
      taskIds: affected.map((t) => t.id),
      params,
      summary,
      createdById: ctx.userId,
    },
  });
  return {
    action_id: row.id,
    status: 'PENDING',
    summary,
    tasks: affected.slice(0, 20).map((t) => ({ title: t.title.slice(0, 80), assignee: t.assignee.fullName, status: t.status })),
    skipped: { not_found: missing, already_closed: tasks.length - affected.length },
    note: 'Изменение НЕ выполнено: под твоим ответом у директора кнопки «Выполнить» / «Отмена». Не пиши, что задачи уже закрыты или удалены.',
  };
}

// ─── Решение ────────────────────────────────────────────────────────────────

/** Выполнить или отменить. Один раз: второе нажатие получит «уже решено». */
export async function decideTaskAction(actionId: string, userId: string, accept: boolean) {
  const row = await prisma.ropTaskAction.findUnique({ where: { id: actionId } });
  if (!row) throw new AppError(404, 'Изменение не найдено');
  const claimed = await prisma.ropTaskAction.updateMany({
    where: { id: actionId, status: 'PENDING' },
    data: { status: accept ? 'DONE' : 'CANCELED', decidedById: userId, decidedAt: new Date() },
  });
  if (!claimed.count) throw new AppError(409, 'По этому изменению уже решили');
  if (!accept) return { ...row, status: 'CANCELED', changed: 0 };

  const ids = row.taskIds as unknown as string[];
  const params = row.params as Record<string, string>;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
  let changed = 0;
  try {
    if (row.action === 'delete') {
      changed = (await prisma.task.deleteMany({ where: { id: { in: ids } } })).count;
    } else if (row.action === 'close') {
      const note = `Закрыто: ${user.fullName} через РОП-агента${params.note ? ` — ${params.note}` : ''}`;
      changed = await prisma.$transaction(async (tx) => {
        const open = await tx.task.findMany({ where: { id: { in: ids }, status: { not: 'APPROVED' } }, select: { id: true, report: true } });
        for (const t of open) {
          await tx.task.update({
            where: { id: t.id },
            data: {
              status: 'APPROVED',
              approvedById: userId,
              approvedAt: new Date(),
              report: t.report?.trim() ? `${t.report.trim()}\n\n${note}` : note,
            },
          });
        }
        return open.length;
      });
    } else if (row.action === 'set_due_date') {
      changed = (await prisma.task.updateMany({
        where: { id: { in: ids } },
        data: { dueDate: new Date(`${params.dueDate}T18:00:00+05:00`) },
      })).count;
    } else if (row.action === 'reassign') {
      changed = (await prisma.task.updateMany({ where: { id: { in: ids } }, data: { assigneeId: params.assigneeId } })).count;
      const moved = await prisma.task.findMany({ where: { id: { in: ids } }, select: { assigneeId: true, title: true } });
      void notifyTasksAssigned(moved, userId);
    }
  } catch (err) {
    // Не вышло — возвращаем черновик, чтобы можно было нажать ещё раз.
    await prisma.ropTaskAction.update({ where: { id: actionId }, data: { status: 'PENDING', decidedById: null, decidedAt: null } });
    throw err;
  }
  await prisma.ropTaskAction.update({ where: { id: actionId }, data: { result: { changed } } });
  return { ...row, status: 'DONE', changed };
}

export function describeTaskAction(action: string): string {
  return ACTION_LABEL[action as TaskActionKind] ?? action;
}

/** Черновики изменений в чате — для страницы. */
export async function listChatTaskActions(chatId: string, userId: string) {
  const chat = await prisma.ropAgentChat.findUnique({ where: { id: chatId }, select: { userId: true } });
  if (!chat || chat.userId !== userId) throw new AppError(404, 'Чат не найден');
  const rows = await prisma.ropTaskAction.findMany({ where: { chatId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    status: r.status,
    tasks: (r.taskIds as unknown as string[]).length,
    changed: (r.result as { changed?: number } | null)?.changed ?? null,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
  }));
}
