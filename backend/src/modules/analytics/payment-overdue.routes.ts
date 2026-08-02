import { Router, Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import XLSX from 'xlsx';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { ownerScope, type AuthUser } from '../../lib/scope';

const router = Router();

router.use(authenticate);

export type PaymentOverdueBucket = 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'NO_DUE_DATE';

const DEFAULT_DUE_SOON_DAYS = 7;
const TASHKENT_TZ = Prisma.sql`'Asia/Tashkent'`;

function getAuthUser(req: Request): AuthUser {
  return {
    userId: req.user!.userId,
    role: req.user!.role as Role,
    permissions: req.user!.permissions || [],
      companyId: req.user!.companyId,
  };
}

function parsePositiveInt(raw: unknown, fallback: number, max = 90): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function classifyBucket(
  dueDate: Date | null,
  daysUntilDue: number | null,
  dueSoonDays: number,
): PaymentOverdueBucket {
  if (!dueDate || daysUntilDue === null) return 'NO_DUE_DATE';
  if (daysUntilDue < 0) return 'OVERDUE';
  if (daysUntilDue <= dueSoonDays) return 'DUE_SOON';
  return 'UPCOMING';
}

type DebtRow = {
  deal_id: string;
  title: string | null;
  status: string;
  amount: string;
  paid_amount: string;
  remaining: string;
  payment_type: string;
  payment_status: string;
  payment_method: string | null;
  due_date: Date | null;
  terms: string | null;
  created_at: Date;
  closed_at: Date | null;
  client_id: string;
  company_name: string;
  is_svip: boolean;
  credit_status: string;
  manager_id: string | null;
  manager_name: string | null;
  manager_department: string | null;
  days_until_due: number | null;
  is_receipt_punched: boolean;
};

/**
 * Все сделки с непогашенным остатком в скоупе пользователя.
 * `dealIds` — необязательный отбор конкретных сделок (используется экспортом,
 * чтобы выгрузить ровно то, что видно на экране после фильтров).
 */
async function fetchDebtRows(
  dealScope: ReturnType<typeof ownerScope>,
  dealIds?: string[],
): Promise<DebtRow[]> {
  const managerFilter = dealScope.managerId
    ? Prisma.sql`AND d.manager_id = ${dealScope.managerId}`
    : Prisma.empty;
  const idFilter =
    dealIds && dealIds.length > 0
      ? Prisma.sql`AND d.id IN (${Prisma.join(dealIds)})`
      : Prisma.empty;

  return prisma.$queryRaw<DebtRow[]>(Prisma.sql`
    SELECT
      d.id AS deal_id,
      d.title,
      d.status::text AS status,
      d.amount::text AS amount,
      d.paid_amount::text AS paid_amount,
      (d.amount - d.paid_amount)::text AS remaining,
      d.payment_type::text AS payment_type,
      d.payment_status::text AS payment_status,
      d.payment_method::text AS payment_method,
      d.due_date,
      d.terms,
      d.created_at,
      d.closed_at,
      d.is_receipt_punched,
      c.id AS client_id,
      c.company_name,
      c.is_svip,
      c.credit_status::text AS credit_status,
      u.id AS manager_id,
      u.full_name AS manager_name,
      u.department AS manager_department,
      CASE
        WHEN d.due_date IS NULL THEN NULL
        ELSE (
          (d.due_date AT TIME ZONE 'UTC' AT TIME ZONE ${TASHKENT_TZ})::date
          - (NOW() AT TIME ZONE 'UTC' AT TIME ZONE ${TASHKENT_TZ})::date
        )::int
      END AS days_until_due
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN users u ON u.id = d.manager_id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND d.payment_status IN ('UNPAID', 'PARTIAL')
      AND (d.amount - d.paid_amount) > 0
      ${managerFilter}
      ${idFilter}
    ORDER BY
      CASE WHEN d.due_date IS NULL THEN 1 ELSE 0 END,
      d.due_date ASC NULLS LAST,
      (d.amount - d.paid_amount) DESC
  `);
}

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'ACCOUNTANT'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    const dealScope = ownerScope(user);
    const dueSoonDays = parsePositiveInt(req.query.dueSoonDays, DEFAULT_DUE_SOON_DAYS);

    const rawRows = await fetchDebtRows(dealScope);

    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent',
    }).format(new Date());

    const rows = rawRows.map((r) => {
      const remaining = Number(r.remaining);
      const daysUntilDue = r.days_until_due;
      const bucket = classifyBucket(r.due_date, daysUntilDue, dueSoonDays);
      const daysOverdue =
        daysUntilDue !== null && daysUntilDue < 0 ? Math.abs(daysUntilDue) : null;
      const daysUntilDuePositive =
        daysUntilDue !== null && daysUntilDue >= 0 ? daysUntilDue : null;

      return {
        dealId: r.deal_id,
        title: r.title,
        status: r.status,
        clientId: r.client_id,
        clientName: r.company_name,
        clientIsSvip: !!r.is_svip,
        creditStatus: r.credit_status,
        managerId: r.manager_id,
        managerName: r.manager_name,
        managerDepartment: r.manager_department,
        paymentType: r.payment_type,
        paymentStatus: r.payment_status,
        paymentMethod: r.payment_method,
        amount: Number(r.amount),
        paidAmount: Number(r.paid_amount),
        remaining,
        dueDate: r.due_date ? r.due_date.toISOString() : null,
        terms: r.terms,
        createdAt: r.created_at.toISOString(),
        closedAt: r.closed_at ? r.closed_at.toISOString() : null,
        isReceiptPunched: r.is_receipt_punched,
        bucket,
        daysOverdue,
        daysUntilDue: daysUntilDuePositive,
      };
    });

    const bucketCounts: Record<PaymentOverdueBucket, number> = {
      OVERDUE: 0,
      DUE_SOON: 0,
      UPCOMING: 0,
      NO_DUE_DATE: 0,
    };
    let totalRemaining = 0;
    let overdueRemaining = 0;
    for (const r of rows) {
      bucketCounts[r.bucket] += 1;
      totalRemaining += r.remaining;
      if (r.bucket === 'OVERDUE') overdueRemaining += r.remaining;
    }

    const managers = [
      ...new Map(
        rows
          .filter((r) => r.managerId && r.managerName)
          .map((r) => [r.managerId!, { id: r.managerId!, fullName: r.managerName! }]),
      ).values(),
    ].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));

    res.json({
      today: todayKey,
      thresholds: { dueSoonDays },
      summary: {
        dealsCount: rows.length,
        totalRemaining: Math.round(totalRemaining * 100) / 100,
        overdueCount: bucketCounts.OVERDUE,
        overdueRemaining: Math.round(overdueRemaining * 100) / 100,
        noDueDateCount: bucketCounts.NO_DUE_DATE,
        bucketCounts,
      },
      managers,
      deals: rows,
    });
  }),
);

const BUCKET_LABELS: Record<PaymentOverdueBucket, string> = {
  OVERDUE: 'Просрочено',
  DUE_SOON: 'Срок скоро',
  UPCOMING: 'В сроке',
  NO_DUE_DATE: 'Без срока',
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  FULL: 'Полная',
  PARTIAL: 'Частично в долг',
  INSTALLMENT: 'Рассрочка',
};

/** `dealIds` из тела (POST) — список видимых на экране сделок в порядке сортировки. */
function parseDealIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return ids.length > 0 ? ids : undefined;
}

const exportHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const dealScope = ownerScope(user);
  const dueSoonDays = parsePositiveInt(req.query.dueSoonDays, DEFAULT_DUE_SOON_DAYS);
  const dealIds = parseDealIds((req.body as { dealIds?: unknown } | undefined)?.dealIds);

  const rawRows = await fetchDebtRows(dealScope, dealIds);

  // Сохраняем порядок строк с экрана, а не порядок из SQL.
  if (dealIds) {
    const order = new Map(dealIds.map((id, i) => [id, i]));
    rawRows.sort((a, b) => (order.get(a.deal_id) ?? 0) - (order.get(b.deal_id) ?? 0));
  }

  const fmtDate = (v: Date | string | null | undefined): string => {
    if (!v) return '';
    return new Date(v).toLocaleDateString('ru-RU');
  };
  const fmtNum = (v: number): number => Math.round(v * 100) / 100;

  const sheet = rawRows.map((r) => {
    const daysUntilDue = r.days_until_due;
    const bucket = classifyBucket(r.due_date, daysUntilDue, dueSoonDays);
    const daysOverdue = daysUntilDue !== null && daysUntilDue < 0 ? Math.abs(daysUntilDue) : null;
    const remaining = Number(r.remaining);

    return {
      'Клиент': r.company_name,
      'Сделка': r.title || '',
      'Статус': BUCKET_LABELS[bucket],
      'Срок оплаты': fmtDate(r.due_date),
      'Просрочено (дн.)': daysOverdue ?? '',
      'Остаток долга (сум)': fmtNum(remaining),
      'Сумма сделки (сум)': fmtNum(Number(r.amount)),
      'Оплачено (сум)': fmtNum(Number(r.paid_amount)),
      'Тип оплаты': PAYMENT_TYPE_LABELS[r.payment_type] ?? r.payment_type,
      'Условия': r.terms || '',
      'Менеджер': r.manager_name || '',
      'Отдел': r.manager_department || '',
      'Статус сделки': r.status === 'CLOSED' ? 'Закрыта' : 'В работе',
      'SVIP': r.is_svip ? 'Да' : 'Нет',
      'Дата сделки': fmtDate(r.created_at),
      'Дата закрытия': fmtDate(r.closed_at),
    };
  });

  const ws = XLSX.utils.json_to_sheet(sheet, {
    header: [
      'Клиент', 'Сделка', 'Статус', 'Срок оплаты', 'Просрочено (дн.)',
      'Остаток долга (сум)', 'Сумма сделки (сум)', 'Оплачено (сум)',
      'Тип оплаты', 'Условия', 'Менеджер', 'Отдел', 'Статус сделки',
      'SVIP', 'Дата сделки', 'Дата закрытия',
    ],
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Просрочка');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const today = new Date().toISOString().slice(0, 10);
  const filename = `payment_overdue_${today}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buf);
});

/**
 * Дата в БД хранится полуночью UTC: SQL-классификация переводит её
 * `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'`, поэтому день не съезжает.
 */
function parseDueDateInput(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw new AppError(400, 'Некорректный срок оплаты');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) throw new AppError(400, 'Срок оплаты должен быть в формате ГГГГ-ММ-ДД');
  const date = new Date(`${raw.trim()}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new AppError(400, 'Некорректный срок оплаты');
  return date;
}

/**
 * Проставить/снять срок оплаты, не заходя в сделку. Принимает и одну сделку, и список
 * (массовая простановка для долгов без даты). `dueDate: null` — убрать срок.
 */
router.patch(
  '/due-date',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    const body = req.body as { dealIds?: unknown; dueDate?: unknown };

    const dealIds = Array.isArray(body.dealIds)
      ? [...new Set(body.dealIds.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))]
      : [];
    if (dealIds.length === 0) throw new AppError(400, 'Не выбрано ни одной сделки');
    if (dealIds.length > 500) throw new AppError(400, 'За один раз можно изменить не более 500 сделок');

    const dueDate = parseDueDateInput(body.dueDate);

    // Скоуп важен: менеджер меняет срок только по своим сделкам.
    const deals = await prisma.deal.findMany({
      where: { id: { in: dealIds }, isArchived: false, ...ownerScope(user) },
      select: { id: true, dueDate: true },
    });
    if (deals.length === 0) throw new AppError(404, 'Сделки не найдены');

    await prisma.deal.updateMany({
      where: { id: { in: deals.map((d) => d.id) } },
      data: { dueDate, version: { increment: 1 } },
    });

    await Promise.all(
      deals.map((d) =>
        auditLog({
          userId: user.userId,
          action: 'UPDATE',
          entityType: 'deal',
          entityId: d.id,
          before: { dueDate: d.dueDate },
          after: { dueDate },
        }),
      ),
    );

    res.json({
      updated: deals.length,
      skipped: dealIds.length - deals.length,
      dueDate: dueDate ? dueDate.toISOString() : null,
    });
  }),
);

const EXPORT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'ACCOUNTANT'] as const;

/** POST — выгрузка ровно того, что отфильтровано на экране; GET — всё, что видит пользователь. */
router.post('/export', authorize(...EXPORT_ROLES), exportHandler);
router.get('/export', authorize(...EXPORT_ROLES), exportHandler);

export { router as paymentOverdueRoutes };
