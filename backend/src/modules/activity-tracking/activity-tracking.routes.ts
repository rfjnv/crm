import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { byUserOrIp, rateLimiter } from '../../middleware/rateLimiter';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { logActivityEvent } from './activity-tracking.service';
import { reportActivityEventDto } from './activity-tracking.dto';

const router = Router();

router.use(authenticate);

// Heartbeat/page-view из фронта — раз в ~60с при активности, плюс на каждую смену страницы.
// Считаем по сотруднику, а не по IP: весь офис сидит за одним адресом и упирался в общий
// лимит. Страхуемся только от зацикленного бага на клиенте.
router.post(
  '/',
  rateLimiter(60_000, 30, byUserOrIp),
  validate(reportActivityEventDto),
  asyncHandler(async (req: Request, res: Response) => {
    await logActivityEvent(req.user!.userId, req.body.type, req.body.path);
    res.json({ ok: true });
  }),
);

export default router;
