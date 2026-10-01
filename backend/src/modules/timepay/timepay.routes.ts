import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { setTimePayTokenDto } from './timepay.dto';
import { getTimePayStatus, setTimePayToken, syncAttendanceFromTimePay, assertYmd, listUnmatchedTimePayEmployees } from './timepay.service';
import { TimePayAuthError } from './timepay.client';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN'));

router.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await getTimePayStatus());
  }),
);

router.put(
  '/token',
  validate(setTimePayTokenDto),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await setTimePayToken(req.body.accessToken, req.user!.userId));
  }),
);

/** Кого из сотрудников TimePay не удалось сопоставить — для ручной привязки в настройках. */
router.get(
  '/unmatched',
  asyncHandler(async (req: Request, res: Response) => {
    const date = assertYmd(req.query.date as string | undefined);
    try {
      res.json(await listUnmatchedTimePayEmployees(date));
    } catch (err) {
      if (err instanceof TimePayAuthError) {
        res.json({ status: 'AUTH_ERROR', employees: [] });
        return;
      }
      throw err;
    }
  }),
);

router.post(
  '/sync',
  asyncHandler(async (req: Request, res: Response) => {
    const date = assertYmd(req.query.date as string | undefined);
    res.json(await syncAttendanceFromTimePay(date));
  }),
);

export default router;
