import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { byUserOrIp, rateLimiter } from '../../middleware/rateLimiter';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { logActivityEvent, logActivityEvents } from './activity-tracking.service';
import { reportActivityDto } from './activity-tracking.dto';

const router = Router();

router.use(authenticate);

// Heartbeat/page-view из фронта — пачкой раз в ~15 с (старые вкладки — по одному событию).
// Считаем по сотруднику, а не по IP: весь офис сидит за одним адресом и упирался в общий
// лимит. Страхуемся только от зацикленного бага на клиенте.
router.post(
  '/',
  rateLimiter(60_000, 30, byUserOrIp),
  validate(reportActivityDto),
  asyncHandler(async (req: Request, res: Response) => {
    if ('events' in req.body) {
      await logActivityEvents(req.user!.userId, req.body.events);
    } else {
      await logActivityEvent(req.user!.userId, req.body.type, req.body.path);
    }
    res.json({ ok: true });
  }),
);

export default router;
