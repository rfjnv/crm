import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';

/** «Изменения в сделках» для бухгалтерии — см. accounting-changes.service.ts. */

const ROLES = ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'] as const;

const router = Router();
router.use(authenticate);

type ChangeRow = Prisma.DealAccountingChangeGetPayload<object>;

/** Подтягивает к записям сделку, клиента, договор и имена — связей у таблицы нет. */
async function hydrate(rows: ChangeRow[]) {
  const dealIds = [...new Set(rows.map((r) => r.dealId))];
  const userIds = [...new Set(rows.flatMap((r) => [r.changedById, r.reviewedById]).filter((x): x is string => !!x))];
  const [deals, users] = await Promise.all([
    prisma.deal.findMany({
      where: { id: { in: dealIds } },
      select: {
        id: true,
        title: true,
        status: true,
        amount: true,
        paymentMethod: true,
        transferInn: true,
        client: { select: { id: true, companyName: true, inn: true } },
        contract: { select: { id: true, contractNumber: true, contractType: true, startDate: true } },
        manager: { select: { id: true, fullName: true } },
      },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
  ]);
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));
  // ИНН — тот, на который шло перечисление, иначе ИНН клиента; юр. имя — из справочника «ИНН и сверка»
  const innOf = (d: (typeof deals)[number]) => (d.transferInn || d.client?.inn || '').replace(/\D/g, '') || null;
  const inns = [...new Set(deals.map(innOf).filter((x): x is string => !!x))];
  const registry = inns.length
    ? await prisma.innRegistry.findMany({ where: { inn: { in: inns } }, select: { inn: true, legalName: true } })
    : [];
  const legalNameByInn = new Map(registry.map((r) => [r.inn, r.legalName]));
  return rows.map((r) => {
    const deal = dealById.get(r.dealId);
    return {
      id: r.id,
      dealId: r.dealId,
      changes: r.changes,
      before: r.before,
      after: r.after,
      editCount: r.editCount,
      createdAt: r.createdAt,
      lastChangedAt: r.lastChangedAt,
      reviewedAt: r.reviewedAt,
      reviewNote: r.reviewNote,
      changedBy: { id: r.changedById, fullName: nameById.get(r.changedById) ?? '—' },
      reviewedBy: r.reviewedById ? { id: r.reviewedById, fullName: nameById.get(r.reviewedById) ?? '—' } : null,
      deal: deal
        ? (() => {
          const inn = innOf(deal);
          return { ...deal, amount: Number(deal.amount), inn, legalName: inn ? legalNameByInn.get(inn) ?? null : null };
        })()
        : null,
    };
  });
}

const listQuery = z.object({
  status: z.enum(['open', 'reviewed']).default('open'),
  dealId: z.string().uuid().optional(),
});

router.get(
  '/',
  authorize(...ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    const rows = await prisma.dealAccountingChange.findMany({
      where: {
        reviewedAt: q.status === 'open' ? null : { not: null },
        ...(q.dealId ? { dealId: q.dealId } : {}),
        // Пустые записи — «вернули как было», их показывать незачем
        NOT: { changes: { equals: [] } },
      },
      orderBy: q.status === 'open' ? { lastChangedAt: 'desc' } : { reviewedAt: 'desc' },
      take: q.status === 'open' ? 500 : 200,
    });
    res.json((await hydrate(rows)).filter((r) => r.deal?.contract));
  }),
);

/** Для дашборда и меню: сколько ждёт проверки и последние пять. */
router.get(
  '/summary',
  authorize(...ROLES),
  asyncHandler(async (_req: Request, res: Response) => {
    // Непроверенных записей немного — фильтр «с договором» дешевле сделать здесь, чем держать связь
    const rows = await prisma.dealAccountingChange.findMany({
      where: { reviewedAt: null },
      orderBy: { lastChangedAt: 'desc' },
      take: 500,
    });
    const withContract = new Set((await prisma.deal.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.dealId))] }, contractId: { not: null } },
      select: { id: true },
    })).map((d) => d.id));
    const open = rows.filter((r) => withContract.has(r.dealId));
    res.json({ open: open.length, latest: await hydrate(open.slice(0, 5)) });
  }),
);

const reviewDto = z.object({ note: z.string().trim().max(500).optional() });

router.post(
  '/:id/review',
  authorize(...ROLES),
  validate(reviewDto),
  asyncHandler(async (req: Request, res: Response) => {
    const row = await prisma.dealAccountingChange.findUnique({ where: { id: req.params.id as string } });
    if (!row) throw new AppError(404, 'Запись не найдена');
    if (row.reviewedAt) throw new AppError(409, 'Уже отмечено как проверенное');
    const updated = await prisma.dealAccountingChange.update({
      where: { id: row.id },
      data: { reviewedAt: new Date(), reviewedById: req.user!.userId, reviewNote: req.body.note || null },
    });
    res.json((await hydrate([updated]))[0]);
  }),
);

export { router as accountingChangesRoutes };
