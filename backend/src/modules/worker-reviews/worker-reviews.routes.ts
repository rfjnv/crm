import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { workerReviewsService } from './worker-reviews.service';
import { createWorkerReviewDto, updateWorkerReviewDto } from './worker-reviews.dto';

const router = Router();

router.use(authenticate);
router.use(authorize('ADMIN', 'SUPER_ADMIN'));

// GET /api/worker-reviews/summaries — cards per worker
router.get(
  '/summaries',
  asyncHandler(async (_req: Request, res: Response) => {
    const data = await workerReviewsService.findSummaries();
    res.json(data);
  }),
);

// GET /api/worker-reviews?managerId=&period=
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const managerId = req.query.managerId as string | undefined;
    const period = req.query.period as string | undefined;
    const data = await workerReviewsService.findAll(managerId, period);
    res.json(data);
  }),
);

// POST /api/worker-reviews
router.post(
  '/',
  validate(createWorkerReviewDto),
  asyncHandler(async (req: Request, res: Response) => {
    const reviewerId = (req as any).user.id as string;
    const review = await workerReviewsService.create(reviewerId, req.body);
    res.status(201).json(review);
  }),
);

// PATCH /api/worker-reviews/:id
router.patch(
  '/:id',
  validate(updateWorkerReviewDto),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const existing = await workerReviewsService.findById(id);
    if (!existing) { res.status(404).json({ message: 'Not found' }); return; }
    const updated = await workerReviewsService.update(id, req.body);
    res.json(updated);
  }),
);

// DELETE /api/worker-reviews/:id
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const existing = await workerReviewsService.findById(id);
    if (!existing) { res.status(404).json({ message: 'Not found' }); return; }
    await workerReviewsService.delete(id);
    res.status(204).send();
  }),
);

export default router;
