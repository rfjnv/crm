import { Router, Request, Response } from 'express';
import { Role, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { ownerScope, type AuthUser } from '../../lib/scope';

const router = Router();
const TASHKENT_TZ = 'Asia/Tashkent';

router.use(authenticate);

export type PaymentOverdueBucket = 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'NO_DUE_DATE';

const DEFAULT_DUE_SOON_DAYS = 7;

function getAuthUser(req: Request): AuthUser {
  return {
    userId: req.user!.userId,
    role: req.user!.role as Role,
    permissions: req.user!.permissions || [],
  };
}

function tashkentDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TASHKENT_TZ }).format(d);
}

function daysBetweenKeys(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00Z`).getTime();
  const to = new Date(`${toKey}T12:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

function parsePositiveInt(raw: unknown, fallback: number, max = 90): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function classifyBucket(
  dueDate: Date | null,
  todayKey: string,
  dueSoonDays: number,
): PaymentOverdueBucket {
  if (!dueDate) return 'NO_DUE_DATE';
  const dueKey = tashkentDateKey(dueDate);
  if (dueKey < todayKey) return 'OVERDUE';
  const daysUntil = daysBetweenKeys(todayKey, dueKey);
  if (daysUntil <= dueSoonDays) return 'DUE_SOON';
  return 'UPCOMING';
}

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'ACCOUNTANT'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    const dealScope = ownerScope(user);
    const dueSoonDays = parsePositiveInt(req.query.dueSoonDays, DEFAULT_DUE_SOON_DAYS);
    const todayKey = tashkentDateKey(new Date());

    const where: Prisma.DealWhereInput = {
      isArchived: false,
      status: { notIn: ['CANCELED', 'REJECTED'] },
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      paymentType: { in: ['PARTIAL', 'INSTALLMENT'] },
      ...(dealScope.managerId ? { managerId: dealScope.managerId } : {}),
    };

    const deals = await prisma.deal.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        amount: true,
        paidAmount: true,
        paymentType: true,
        paymentStatus: true,
        paymentMethod: true,
        dueDate: true,
        terms: true,
        createdAt: true,
        closedAt: true,
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true, department: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    const rows = deals
      .map((d) => {
        const amount = Number(d.amount);
        const paidAmount = Number(d.paidAmount);
        const remaining = Math.round((amount - paidAmount) * 100) / 100;
        if (remaining <= 0) return null;

        const bucket = classifyBucket(d.dueDate, todayKey, dueSoonDays);
        const dueKey = d.dueDate ? tashkentDateKey(d.dueDate) : null;
        const daysOverdue =
          bucket === 'OVERDUE' && dueKey ? daysBetweenKeys(dueKey, todayKey) : null;
        const daysUntilDue =
          d.dueDate && bucket !== 'OVERDUE' && dueKey
            ? daysBetweenKeys(todayKey, dueKey)
            : null;

        return {
          dealId: d.id,
          title: d.title,
          status: d.status,
          clientId: d.client.id,
          clientName: d.client.companyName,
          clientIsSvip: !!d.client.isSvip,
          creditStatus: d.client.creditStatus,
          managerId: d.manager?.id ?? null,
          managerName: d.manager?.fullName ?? null,
          managerDepartment: d.manager?.department ?? null,
          paymentType: d.paymentType,
          paymentStatus: d.paymentStatus,
          paymentMethod: d.paymentMethod,
          amount,
          paidAmount,
          remaining,
          dueDate: d.dueDate ? d.dueDate.toISOString() : null,
          terms: d.terms,
          createdAt: d.createdAt.toISOString(),
          closedAt: d.closedAt ? d.closedAt.toISOString() : null,
          bucket,
          daysOverdue,
          daysUntilDue,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

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
        bucketCounts,
      },
      managers,
      deals: rows,
    });
  }),
);

export { router as paymentOverdueRoutes };
