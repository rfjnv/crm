import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { upsertEmployeeReviewDto } from './employee-cards.dto';
import { assertPeriod, getEmployeeCard, listEmployeeCards, upsertEmployeeReview } from './employee-cards.service';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN', 'HR'));

function period(req: Request): { year: number; month: number } {
  const nowTk = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const year = Number(req.query.year) || nowTk.getUTCFullYear();
  const month = Number(req.query.month) || nowTk.getUTCMonth() + 1;
  assertPeriod(year, month);
  return { year, month };
}

// GET /api/employee-cards?year=&month= — все сотрудники за месяц
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = period(req);
    res.json({ year, month, rows: await listEmployeeCards(year, month) });
  }),
);

// GET /api/employee-cards/:userId?year=&month= — карточка + история за полгода
router.get(
  '/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = period(req);
    res.json({ year, month, ...(await getEmployeeCard(req.params.userId as string, year, month)) });
  }),
);

// PUT /api/employee-cards/:userId/review — оценка HR за месяц
router.put(
  '/:userId/review',
  validate(upsertEmployeeReviewDto),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await upsertEmployeeReview(req.params.userId as string, req.body, req.user!));
  }),
);

export default router;
