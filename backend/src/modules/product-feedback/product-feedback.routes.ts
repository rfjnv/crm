import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { AppError } from '../../lib/errors';
import { productFeedbackService } from './product-feedback.service';

/**
 * Обзвон «как вам товар»: после прихода партии менеджеры звонят клиентам, которые её купили,
 * записывают отзыв и видят, кто из коллег последним общался с клиентом.
 */
const router = Router();

router.use(authenticate);

const ACCESS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'OPERATOR'];

function assertAccess(role: Role) {
  if (!ACCESS_ROLES.includes(role)) throw new AppError(403, 'Недостаточно прав');
}

const clientsQueryDto = z.object({
  productId: z.string().uuid(),
  from: z.string().datetime({ offset: true }),
});

const createFeedbackDto = z
  .object({
    productId: z.string().uuid(),
    clientId: z.string().uuid(),
    reached: z.boolean(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
    arrivalAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.reached && !data.rating) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rating'], message: 'Поставьте оценку' });
    }
  });

router.get(
  '/products',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    res.json(await productFeedbackService.listProductsWithArrivals());
  }),
);

router.get(
  '/arrivals/:productId',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const productId = z.string().uuid().parse(req.params.productId);
    res.json(await productFeedbackService.listArrivals(productId));
  }),
);

router.get(
  '/clients',
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const { productId, from } = clientsQueryDto.parse(req.query);
    res.json(await productFeedbackService.listClients(productId, new Date(from)));
  }),
);

router.post(
  '/',
  validate(createFeedbackDto),
  asyncHandler(async (req: Request, res: Response) => {
    assertAccess(req.user!.role as Role);
    const row = await productFeedbackService.create(req.body, req.user!.userId);
    res.status(201).json(row);
  }),
);

export default router;
