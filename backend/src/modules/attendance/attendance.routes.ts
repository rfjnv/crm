import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { upsertAttendanceDto } from './attendance.dto';
import { listAttendance, upsertAttendance, deleteAttendance } from './attendance.service';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN'));

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, from, to } = req.query;
    const records = await listAttendance({
      userId: userId as string | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
    });
    res.json({ records });
  }),
);

router.post(
  '/',
  validate(upsertAttendanceDto),
  asyncHandler(async (req: Request, res: Response) => {
    const record = await upsertAttendance(req.body, req.user!.userId);
    res.json(record);
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await deleteAttendance(req.params.id as string);
    res.json({ ok: true });
  }),
);

export default router;
