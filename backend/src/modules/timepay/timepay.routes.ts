import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { setTimePayTokenDto, updateTimePaySettingsDto } from './timepay.dto';
import {
  getTimePayStatus,
  setTimePayToken,
  syncAttendanceFromTimePay,
  assertYmd,
  listTimePayEmployees,
  updateTimePaySettings,
} from './timepay.service';
import { TimePayAuthError } from './timepay.client';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN', 'HR'));

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

/** Сотрудники TimePay выбранных филиалов (привязанные и нет) и скрытые — для настроек. */
router.get(
  '/employees',
  asyncHandler(async (req: Request, res: Response) => {
    const date = assertYmd(req.query.date as string | undefined);
    try {
      res.json(await listTimePayEmployees(date));
    } catch (err) {
      if (err instanceof TimePayAuthError) {
        res.json({ status: 'AUTH_ERROR', employees: [], hidden: [] });
        return;
      }
      throw err;
    }
  }),
);

/** Филиалы для синхронизации и скрытые сотрудники. */
router.put(
  '/settings',
  validate(updateTimePaySettingsDto),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateTimePaySettings(req.body));
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
