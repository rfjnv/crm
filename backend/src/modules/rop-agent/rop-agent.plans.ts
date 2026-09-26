import { COST_ACCESS_REQUIRED } from '../../lib/costAccess';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

/**
 * Планы задач от РОП-агента. Агент пишет только черновик; задачи менеджерам
 * создаются, когда директор проверит план и нажмёт «Раздать». Имена и телефоны
 * берутся из базы по id, а не из текста модели, — чтобы в задачу не попал
 * выдуманный клиент.
 */

export type PlanStatus = 'DRAFT' | 'ASSIGNED' | 'DISCARDED';

export type PlanClient = {
  clientId: string;
  name: string;
  phone: string | null;
  /** Почему этот клиент в списке (факты: когда брал, что, сколько). */
  reason: string;
  /** Что предложить или выяснить. */
  offer: string;
  /** Задача, в чек-лист которой попал клиент (после раздачи). */
  taskId?: string;
};

export type PlanItem = {
  key: string;
  managerId: string;
  managerName: string;
  title: string;
  description: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  clients: PlanClient[];
  taskIds?: string[];
};

/** В чек-листе задачи не больше 50 пунктов (tasks.dto) — длинный список режем на части. */
const CHECKLIST_MAX = 50;
const CHECKLIST_TEXT_MAX = 300;
const MAX_CLIENTS_PER_ITEM = 200;

type RawClient = { client_id?: unknown; clientId?: unknown; reason?: unknown; offer?: unknown };
type RawItem = {
  key?: unknown;
  manager_id?: unknown; managerId?: unknown;
  title?: unknown; description?: unknown;
  due_date?: unknown; dueDate?: unknown;
  clients?: unknown;
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Приводит план (от агента или после правки на странице) к проверенному виду:
 * менеджеры и клиенты существуют, клиент встречается один раз, пустые задачи убраны.
 * Всё, что выброшено, возвращается в warnings — агент и директор должны это видеть.
 */
async function normalizeItems(rawItems: unknown): Promise<{ items: PlanItem[]; warnings: string[] }> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new AppError(400, 'В плане нет ни одной задачи');
  const warnings: string[] = [];
  const raw = rawItems as RawItem[];

  const managerIds = [...new Set(raw.map((i) => str(i.manager_id ?? i.managerId, 64)).filter(Boolean))];
  const clientIds = [...new Set(raw.flatMap((i) => (Array.isArray(i.clients) ? i.clients as RawClient[] : [])
    .map((c) => str(c.client_id ?? c.clientId, 64)).filter(Boolean)))];

  const [managers, clients] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: managerIds }, isActive: true }, select: { id: true, fullName: true } }),
    prisma.client.findMany({
      where: { id: { in: clientIds }, isArchived: false },
      select: { id: true, companyName: true, phone: true, relation: true },
    }),
  ]);
  const managerById = new Map(managers.map((m) => [m.id, m]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const seenClients = new Set<string>();

  const items: PlanItem[] = [];
  for (const it of raw) {
    const managerId = str(it.manager_id ?? it.managerId, 64);
    const manager = managerById.get(managerId);
    const title = str(it.title, 200);
    if (!manager) {
      warnings.push(`Задача «${title || 'без названия'}»: сотрудник ${managerId || '(не указан)'} не найден или неактивен — пропущена`);
      continue;
    }
    const dueRaw = str(it.due_date ?? it.dueDate, 10);
    const planClients: PlanClient[] = [];
    for (const c of (Array.isArray(it.clients) ? it.clients as RawClient[] : [])) {
      const id = str(c.client_id ?? c.clientId, 64);
      const client = clientById.get(id);
      if (!client) {
        warnings.push(`Клиент ${id || '(без id)'} не найден или в архиве — убран из задачи для ${manager.fullName}`);
        continue;
      }
      if (seenClients.has(id)) {
        warnings.push(`${client.companyName} уже есть в плане — повтор убран`);
        continue;
      }
      seenClients.add(id);
      // Не запрещаем — директор может поручить и такое, — но предупреждаем.
      if (client.relation === 'AFFILIATE') warnings.push(`${client.companyName} — своя/союзная компания, не клиент`);
      if (client.relation === 'COMPETITOR') warnings.push(`${client.companyName} — конкурент, не клиент`);
      planClients.push({
        clientId: id,
        name: client.companyName,
        phone: client.phone,
        reason: str(c.reason, 500),
        offer: str(c.offer, 500),
      });
    }
    if (planClients.length > MAX_CLIENTS_PER_ITEM) {
      warnings.push(`У ${manager.fullName} больше ${MAX_CLIENTS_PER_ITEM} клиентов — оставлены первые ${MAX_CLIENTS_PER_ITEM}`);
      planClients.length = MAX_CLIENTS_PER_ITEM;
    }
    if (!title) {
      warnings.push(`Задача для ${manager.fullName} без названия — пропущена`);
      continue;
    }
    items.push({
      key: str(it.key, 64) || randomUUID(),
      managerId: manager.id,
      managerName: manager.fullName,
      title,
      description: str(it.description, 4000),
      dueDate: dueRaw && isDate(dueRaw) ? dueRaw : null,
      clients: planClients,
    });
  }
  if (!items.length) throw new AppError(400, `После проверки в плане не осталось задач. ${warnings.join('; ')}`);
  return { items, warnings };
}

async function getOwnPlan(planId: string, userId: string) {
  const plan = await prisma.ropTaskPlan.findUnique({ where: { id: planId }, include: { chat: { select: { userId: true } } } });
  if (!plan || plan.chat.userId !== userId) throw new AppError(404, 'План не найден');
  return plan;
}

const publicPlan = (p: { id: string; chatId: string; title: string; goal: string | null; status: string; items: Prisma.JsonValue; assignedAt: Date | null; createdAt: Date; updatedAt: Date }) => ({
  id: p.id,
  chatId: p.chatId,
  title: p.title,
  goal: p.goal,
  status: p.status as PlanStatus,
  items: p.items as unknown as PlanItem[],
  assignedAt: p.assignedAt,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

// ─── Агент ──────────────────────────────────────────────────────────────────

/** Инструмент propose_task_plan: сохраняет черновик и отдаёт агенту итог проверки. */
export async function proposeTaskPlan(
  ctx: { chatId: string; userId: string },
  input: { title?: unknown; goal?: unknown; tasks?: unknown },
) {
  const title = str(input.title, 200);
  if (!title) throw new AppError(400, 'Нужно название плана (title)');
  const { items, warnings } = await normalizeItems(input.tasks);
  const plan = await prisma.ropTaskPlan.create({
    data: {
      chatId: ctx.chatId,
      title,
      goal: str(input.goal, 2000) || null,
      items: items as unknown as Prisma.InputJsonValue,
      createdById: ctx.userId,
    },
  });
  return {
    plan_id: plan.id,
    status: 'DRAFT',
    tasks: items.map((i) => ({ manager: i.managerName, title: i.title, due_date: i.dueDate, clients: i.clients.length })),
    warnings,
    note: 'Черновик сохранён и показан директору под твоим ответом. Задачи ещё НЕ розданы: директор проверит, поправит и нажмёт «Раздать».',
  };
}

// ─── Страница ───────────────────────────────────────────────────────────────

export async function listChatPlans(chatId: string, userId: string, costOpen = false) {
  const chat = await prisma.ropAgentChat.findUnique({ where: { id: chatId }, select: { userId: true, costMode: true } });
  if (!chat || chat.userId !== userId) throw new AppError(404, 'Чат не найден');
  if (chat.costMode && !costOpen) {
    throw new AppError(403, 'Чат с себестоимостью. Откройте себестоимость по ПИН-коду.', COST_ACCESS_REQUIRED);
  }
  const plans = await prisma.ropTaskPlan.findMany({ where: { chatId }, orderBy: { createdAt: 'asc' } });
  return plans.map(publicPlan);
}

export async function updatePlan(planId: string, userId: string, data: { title?: string; items: unknown }) {
  const plan = await getOwnPlan(planId, userId);
  if (plan.status !== 'DRAFT') throw new AppError(409, 'План уже роздан или отклонён — изменить нельзя');
  const { items, warnings } = await normalizeItems(data.items);
  const updated = await prisma.ropTaskPlan.update({
    where: { id: planId },
    data: { title: data.title?.trim() || plan.title, items: items as unknown as Prisma.InputJsonValue },
  });
  return { plan: publicPlan(updated), warnings };
}

export async function discardPlan(planId: string, userId: string) {
  const plan = await getOwnPlan(planId, userId);
  if (plan.status !== 'DRAFT') throw new AppError(409, 'План уже роздан или отклонён');
  return publicPlan(await prisma.ropTaskPlan.update({ where: { id: planId }, data: { status: 'DISCARDED' } }));
}

function checklistText(c: PlanClient): string {
  const who = c.phone ? `${c.name} (${c.phone})` : c.name;
  const parts = [who, c.offer, c.reason].filter(Boolean);
  const text = parts.join(' — ');
  return text.length > CHECKLIST_TEXT_MAX ? `${text.slice(0, CHECKLIST_TEXT_MAX - 1)}…` : text;
}

/** Срок до конца рабочего дня по Ташкенту. */
function dueDateOf(ymd: string | null): Date | undefined {
  return ymd ? new Date(`${ymd}T18:00:00+05:00`) : undefined;
}

/**
 * «Раздать»: по задаче на менеджера (длинный список клиентов — несколькими задачами
 * по 50), автор — тот, кто утвердил. Всё в одной транзакции: либо розданы все, либо ни одна.
 */
export async function assignPlan(planId: string, userId: string) {
  const plan = await getOwnPlan(planId, userId);
  if (plan.status !== 'DRAFT') throw new AppError(409, 'План уже роздан или отклонён');
  // Менеджер мог уволиться, клиент — уйти в архив, пока план лежал черновиком.
  const { items, warnings } = await normalizeItems(plan.items);

  const assigned = await prisma.$transaction(async (tx) => {
    const out: PlanItem[] = [];
    for (const item of items) {
      const chunks: PlanClient[][] = [];
      for (let i = 0; i < item.clients.length; i += CHECKLIST_MAX) chunks.push(item.clients.slice(i, i + CHECKLIST_MAX));
      if (!chunks.length) chunks.push([]);

      const taskIds: string[] = [];
      const clients: PlanClient[] = [];
      for (const [n, chunk] of chunks.entries()) {
        const suffix = chunks.length > 1 ? ` (${n + 1}/${chunks.length})` : '';
        const task = await tx.task.create({
          data: {
            title: `${item.title}${suffix}`.slice(0, 250),
            description: [
              item.description,
              chunk.length ? 'Клиенты — в чек-листе. Отмечайте каждого после связи, итог по каждому напишите в отчёте.' : '',
            ].filter(Boolean).join('\n\n') || undefined,
            assigneeId: item.managerId,
            createdById: userId,
            dueDate: dueDateOf(item.dueDate),
            checklist: chunk.map((c) => ({ text: checklistText(c), checked: false })),
          },
          select: { id: true },
        });
        taskIds.push(task.id);
        clients.push(...chunk.map((c) => ({ ...c, taskId: task.id })));
      }
      out.push({ ...item, clients, taskIds });
    }
    await tx.ropTaskPlan.update({
      where: { id: planId },
      data: {
        status: 'ASSIGNED',
        items: out as unknown as Prisma.InputJsonValue,
        assignedById: userId,
        assignedAt: new Date(),
      },
    });
    return out;
  });

  return {
    plan: publicPlan(await prisma.ropTaskPlan.findUniqueOrThrow({ where: { id: planId } })),
    createdTasks: assigned.reduce((s, i) => s + (i.taskIds?.length ?? 0), 0),
    warnings,
  };
}
