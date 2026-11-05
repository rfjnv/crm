import { Router, Request, Response } from 'express';
import { PaymentRequestStatus } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import type { AuthUser } from '../../lib/scope';
import {
  DECIDE_ROLES,
  acceptPaymentRequestDto,
  createPaymentRequestDto,
  paymentRequestsService,
  rejectPaymentRequestDto,
} from './payment-requests.service';

const CREATE_ROLES = ['MANAGER', 'OPERATOR', ...DECIDE_ROLES] as const;

const availableQuery = z.object({
  clientId: z.string().uuid('Выберите клиента'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const authUser = (req: Request) => req.user as unknown as AuthUser;

const router = Router();
router.use(authenticate);

router.get('/summary', authorize(...DECIDE_ROLES), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ pending: await paymentRequestsService.pendingCount() });
}));

router.get('/available', authorize(...CREATE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const parsed = availableQuery.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message || 'Некорректный период');
  const { clientId, from, to } = parsed.data;
  res.json(await paymentRequestsService.available(clientId, from, to, authUser(req)));
}));

router.get('/', authorize(...CREATE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const status = z.nativeEnum(PaymentRequestStatus).optional().safeParse(req.query.status || undefined);
  if (!status.success) throw new AppError(400, 'Некорректный статус');
  res.json(await paymentRequestsService.list(status.data, authUser(req)));
}));

router.post('/', authorize(...CREATE_ROLES), validate(createPaymentRequestDto), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await paymentRequestsService.create(req.body, authUser(req)));
}));

router.get('/:id/preview', authorize(...DECIDE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  res.json(await paymentRequestsService.preview(req.params.id as string));
}));

router.post('/:id/accept', authorize(...DECIDE_ROLES), validate(acceptPaymentRequestDto), asyncHandler(async (req: Request, res: Response) => {
  res.json(await paymentRequestsService.accept(req.params.id as string, req.body, authUser(req)));
}));

router.post('/:id/reject', authorize(...DECIDE_ROLES), validate(rejectPaymentRequestDto), asyncHandler(async (req: Request, res: Response) => {
  res.json(await paymentRequestsService.reject(req.params.id as string, req.body.reason, authUser(req)));
}));

router.post('/:id/cancel', authorize(...CREATE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  res.json(await paymentRequestsService.cancel(req.params.id as string, authUser(req)));
}));

export { router as paymentRequestsRoutes };
