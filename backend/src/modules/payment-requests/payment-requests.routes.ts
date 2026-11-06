import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
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
import { MAX_IMAGE_BYTES, recognizePaymentTable } from './payment-requests.recognize';

const CREATE_ROLES = ['MANAGER', 'OPERATOR', ...DECIDE_ROLES] as const;

const availableQuery = z.object({
  clientId: z.string().uuid('Выберите клиента'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });

function uploadImage(req: Request, res: Response, next: NextFunction): void {
  upload.single('image')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(400, 'Фото слишком большое, максимум 3,7 МБ'));
    }
    next(err);
  });
}

/** Тип определяем по содержимому файла: браузер может прислать неверный, а API такое отклонит. */
function imageTypeOf(buf: Buffer) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg' as const;
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png' as const;
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp' as const;
  if (buf.length > 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return 'image/gif' as const;
  return null;
}

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

router.post('/recognize', authorize(...CREATE_ROLES), uploadImage, asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError(400, 'Загрузите фото таблицы');
  const type = imageTypeOf(req.file.buffer);
  if (!type) throw new AppError(400, 'Нужно фото в формате JPG, PNG, WEBP или GIF');
  res.json(await recognizePaymentTable(req.file.buffer, type));
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
