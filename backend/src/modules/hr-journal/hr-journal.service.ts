import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { hrReviewScore } from '../employee-cards/employee-cards.service';

/**
 * Журнал HR: всё, что HR написала и сделала, одной лентой — для руководства.
 *
 * Отдельной таблицы нет: записи собираются из мест, где они уже лежат —
 * плашки и комментарии посещаемости, оценки в карточках, приём/увольнение
 * сотрудников (журнал аудита), планы и оклады. Так журнал не расходится с
 * самими разделами.
 */

export type JournalType = 'attendance' | 'review' | 'staff' | 'goal';

export interface JournalItem {
  id: string;
  type: JournalType;
  at: Date;
  author: { id: string; fullName: string; role: string };
  employee: { id: string; fullName: string } | null;
  /** Короткий заголовок: «Не пришёл», «Оценка за октябрь», «Принят на работу»… */
  title: string;
  /** Дата, к которой запись относится (день посещаемости, месяц оценки) — YYYY-MM-DD. */
  forDate?: string | null;
  marks?: string[];
  scores?: { discipline: number | null; quality: number | null; initiative: number | null; teamwork: number | null; avg: number | null };
  texts?: { label: string; text: string }[];
  details?: string[];
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Суперадмин', ADMIN: 'Администратор', OPERATOR: 'Оператор', MANAGER: 'Менеджер', HR: 'HR',
  ACCOUNTANT: 'Бухгалтер', FOREIGN_TRADE: 'ВЭД', WAREHOUSE: 'Склад', WAREHOUSE_MANAGER: 'Зав. складом',
  DRIVER: 'Водитель', LOADER: 'Грузчик',
};
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MAX_ITEMS = 1000;

const authorSelect = { id: true, fullName: true, role: true } as const;

/** Что поменялось в карточке пользователя — по снимкам до/после из журнала аудита. */
function describeUserChange(action: string, before: unknown, after: unknown): { title: string; details: string[] } {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  if (action === 'CREATE') {
    return {
      title: 'Принят на работу',
      details: [
        `Роль: ${ROLE_LABELS[String(a.role)] ?? a.role ?? '—'}`,
        ...(a.department ? [`Отдел: ${a.department}`] : []),
        ...(a.login ? [`Логин: ${a.login}`] : []),
      ],
    };
  }
  if (action === 'ARCHIVE') return { title: 'Уволен (доступ закрыт)', details: [] };
  if (action === 'RESTORE') return { title: 'Восстановлен', details: [] };
  if (action === 'DELETE') return { title: 'Удалён', details: [] };

  const details: string[] = [];
  const fields: [string, string, (v: unknown) => string][] = [
    ['fullName', 'ФИО', (v) => String(v ?? '—')],
    ['login', 'Логин', (v) => String(v ?? '—')],
    ['role', 'Роль', (v) => ROLE_LABELS[String(v)] ?? String(v ?? '—')],
    ['department', 'Отдел', (v) => (v ? String(v) : '—')],
    ['badgeLabel', 'Медаль', (v) => (v ? `«${v}»` : 'снята')],
  ];
  for (const [key, label, fmt] of fields) {
    if (key in a && JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) {
      details.push(`${label}: ${fmt(b[key])} → ${fmt(a[key])}`);
    }
  }
  if ('isActive' in a && a.isActive !== b.isActive) {
    return { title: a.isActive ? 'Восстановлен' : 'Уволен (доступ закрыт)', details };
  }
  return { title: details.length ? 'Изменены данные сотрудника' : 'Сохранена карточка сотрудника (без изменений)', details };
}

export async function getHrJournal(opts: {
  from: Date;
  to: Date;
  type?: JournalType;
  employeeId?: string;
  authorId?: string;
  /** true — записи только авторов с ролью HR; false — всех, кто это делал (в т.ч. админов). */
  onlyHr: boolean;
}): Promise<{ items: JournalItem[]; truncated: boolean }> {
  if (opts.to < opts.from) throw new AppError(400, 'Конец периода раньше начала');

  const authorFilter = {
    ...(opts.authorId ? { id: opts.authorId } : {}),
    ...(opts.onlyHr ? { role: 'HR' as const } : {}),
  };
  const hasAuthorFilter = Object.keys(authorFilter).length > 0;
  const want = (t: JournalType) => !opts.type || opts.type === t;
  const range = { gte: opts.from, lt: opts.to };

  const [attendance, reviews, audits, goals] = await Promise.all([
    want('attendance')
      ? prisma.attendanceRecord.findMany({
          where: {
            markedAt: range,
            markedById: { not: null },
            OR: [{ marks: { isEmpty: false } }, { note: { not: null } }],
            ...(opts.employeeId ? { userId: opts.employeeId } : {}),
            ...(hasAuthorFilter ? { markedBy: authorFilter } : {}),
          },
          select: {
            id: true, date: true, marks: true, note: true, markedAt: true, checkIn: true, checkOut: true,
            user: { select: { id: true, fullName: true } },
            markedBy: { select: authorSelect },
          },
          orderBy: { markedAt: 'desc' },
          take: MAX_ITEMS,
        })
      : [],
    want('review')
      ? prisma.employeeMonthlyReview.findMany({
          where: {
            updatedAt: range,
            ...(opts.employeeId ? { userId: opts.employeeId } : {}),
            ...(hasAuthorFilter ? { reviewer: authorFilter } : {}),
          },
          include: { user: { select: { id: true, fullName: true } }, reviewer: { select: authorSelect } },
          orderBy: { updatedAt: 'desc' },
          take: MAX_ITEMS,
        })
      : [],
    want('staff')
      ? prisma.auditLog.findMany({
          where: {
            entityType: 'user',
            action: { in: ['CREATE', 'UPDATE', 'ARCHIVE', 'RESTORE', 'DELETE'] },
            createdAt: range,
            ...(opts.employeeId ? { entityId: opts.employeeId } : {}),
            ...(hasAuthorFilter ? { user: authorFilter } : {}),
          },
          select: { id: true, action: true, entityId: true, before: true, after: true, createdAt: true, user: { select: authorSelect } },
          orderBy: { createdAt: 'desc' },
          take: MAX_ITEMS,
        })
      : [],
    want('goal')
      ? prisma.userMonthlyGoal.findMany({
          where: {
            updatedAt: range,
            updatedById: { not: null },
            ...(opts.employeeId ? { userId: opts.employeeId } : {}),
            ...(hasAuthorFilter ? { updatedBy: authorFilter } : {}),
          },
          include: { user: { select: { id: true, fullName: true } }, updatedBy: { select: authorSelect } },
          orderBy: { updatedAt: 'desc' },
          take: MAX_ITEMS,
        })
      : [],
  ]);

  // Имена сотрудников для записей аудита (там только id)
  const staffIds = [...new Set(audits.map((a) => a.entityId).filter((x): x is string => !!x))];
  const staffUsers = staffIds.length
    ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } })
    : [];
  const staffMap = new Map(staffUsers.map((u) => [u.id, u]));

  const items: JournalItem[] = [];

  for (const r of attendance) {
    if (!r.markedBy || !r.markedAt) continue;
    items.push({
      id: `att-${r.id}`,
      type: 'attendance',
      at: r.markedAt,
      author: r.markedBy,
      employee: r.user,
      title: r.marks.length ? 'Отметка посещаемости' : 'Комментарий к посещаемости',
      forDate: r.date.toISOString().slice(0, 10),
      marks: r.marks,
      texts: r.note ? [{ label: 'Комментарий', text: r.note }] : [],
    });
  }

  for (const r of reviews) {
    items.push({
      id: `rev-${r.id}`,
      type: 'review',
      at: r.updatedAt,
      author: r.reviewer,
      employee: r.user,
      title: `Оценка за ${MONTHS[r.month - 1]} ${r.year}`,
      forDate: `${r.year}-${String(r.month).padStart(2, '0')}-01`,
      scores: {
        discipline: r.discipline, quality: r.quality, initiative: r.initiative, teamwork: r.teamwork,
        avg: hrReviewScore(r),
      },
      texts: [
        ...(r.praise ? [{ label: 'Похвала', text: r.praise }] : []),
        ...(r.remarks ? [{ label: 'Замечания', text: r.remarks }] : []),
        ...(r.improve ? [{ label: 'Что улучшить', text: r.improve }] : []),
      ],
    });
  }

  for (const a of audits) {
    const { title, details } = describeUserChange(a.action, a.before, a.after);
    // Пустые сохранения формы без изменений журнал не засоряют
    if (a.action === 'UPDATE' && details.length === 0) continue;
    const emp = a.entityId ? staffMap.get(a.entityId) : undefined;
    const afterName = (a.after as Record<string, unknown> | null)?.fullName;
    items.push({
      id: `aud-${a.id}`,
      type: 'staff',
      at: a.createdAt,
      author: a.user,
      employee: emp ?? (a.entityId ? { id: a.entityId, fullName: String(afterName ?? 'Удалённый сотрудник') } : null),
      title,
      details,
    });
  }

  for (const g of goals) {
    if (!g.updatedBy) continue;
    const money = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
    const details = [
      ...(g.revenueTarget !== null ? [`План по выручке: ${money(g.revenueTarget)!.toLocaleString('ru-RU')}`] : []),
      ...(g.fixedSalary !== null ? [`Оклад: ${money(g.fixedSalary)!.toLocaleString('ru-RU')}`] : []),
      ...(g.dealsTarget !== null ? [`План по сделкам: ${g.dealsTarget}`] : []),
      ...(g.callNotesTarget !== null ? [`План по контактам: ${g.callNotesTarget}`] : []),
    ];
    items.push({
      id: `goal-${g.id}`,
      type: 'goal',
      at: g.updatedAt,
      author: g.updatedBy,
      employee: g.user,
      title: `План и оклад на ${MONTHS[g.month - 1]} ${g.year}`,
      forDate: `${g.year}-${String(g.month).padStart(2, '0')}-01`,
      details,
    });
  }

  items.sort((x, y) => y.at.getTime() - x.at.getTime());
  return { items: items.slice(0, MAX_ITEMS), truncated: items.length > MAX_ITEMS };
}
