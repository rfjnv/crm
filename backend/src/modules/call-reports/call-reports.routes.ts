import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { PERMISSIONS } from '../../lib/permissions';
import { getCallReport, tkDayStart } from './call-reports.service';

const router = Router();

router.use(authenticate);
/** HR, ВЭД, админы и РОП (право use_rop_agent). Только цифры — записи разговоров здесь не отдаются. */
router.use((req: Request, _res: Response, next: NextFunction) => {
  const u = req.user!;
  const ok = ['SUPER_ADMIN', 'ADMIN', 'HR', 'FOREIGN_TRADE'].includes(u.role) || (u.permissions ?? []).includes(PERMISSIONS.USE_ROP_AGENT);
  if (!ok) throw new AppError(403, 'Недостаточно прав');
  next();
});

// GET /api/call-reports?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.from || !q.to) throw new AppError(400, 'Укажите период');
    const from = tkDayStart(q.from);
    const to = new Date(tkDayStart(q.to).getTime() + 86400000);
    res.json(await getCallReport({ from, to, userId: q.userId || undefined }));
  }),
);

export default router;
