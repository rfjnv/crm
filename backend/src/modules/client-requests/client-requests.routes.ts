import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { AppError } from '../../lib/errors';
import { clientRequestsService, REQUEST_KINDS, REQUEST_STATUSES } from './client-requests.service';

/**
 * Запросы клиентов: менеджер записывает, какой товар (или что-то другое) хочет клиент,
 * ВЭД и админы видят, что чаще всего просят, и закрывают запросы.
 */
const router = Router();

router.use(authenticate);

// HR работает в ВЭД на полставки — у неё всё, что есть у ВЭД.
const ACCESS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FOREIGN_TRADE', 'HR'];
const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN'];

function assertAccess(role: Role) {
  if (!ACCESS_ROLES.includes(role)) throw new AppError(403, 'Недостаточно прав');
}

const listQuery = z.object({
  status: z.enum([...REQUEST_STATUSES, 'OPEN']).optional(),
  kind: z.enum(REQUEST_KINDS).optional(),
  clientId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  authorId: z.string().uuid().optional(),
});

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

const createDto = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(REQUEST_KINDS),
  productId: z.string().uuid().nullable().optional(),
  productName: nullableText(300),
  quantity: z.number().positive().max(1e9).nullable().optional(),
  unit: nullableText(30),
  description: nullableText(3000),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
});

const updateDto = createDto.partial().extend({
  status: z.enum(REQUEST_STATUSES).optional(),
  resolution: nullableText(3000),
});

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    res.json(await clientRequestsService.list(listQuery.parse(req.query)));
  }),
);

router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    res.json(await clientRequestsService.summary());
  }),
);

router.get(
  '/clients',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const q = z.string().max(100).optional().parse(req.query.q) ?? '';
    res.json(await clientRequestsService.options(q));
  }),
);

router.get(
  '/products',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    res.json(await clientRequestsService.products());
  }),
);

router.post(
  '/',
  validate(createDto),
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    res.status(201).json(await clientRequestsService.create(req.body, req.user!.userId));
  }),
);

router.patch(
  '/:id',
  validate(updateDto),
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const id = z.string().uuid().parse(req.params.id);
    res.json(await clientRequestsService.update(id, req.body, req.user!.userId));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role as Role;
    assertAccess(role);
    const id = z.string().uuid().parse(req.params.id);
    await clientRequestsService.remove(id, req.user!.userId, ADMIN_ROLES.includes(role));
    res.json({ success: true });
  }),
);

export default router;
