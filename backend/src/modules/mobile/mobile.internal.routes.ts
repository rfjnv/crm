import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { assertInternalToken } from '../internal/reports.routes';
import { kickAudioQueue, runMobileTick } from './mobile.tick';

/**
 * POST /api/internal/mobile/tick — то же, что делает планировщик. Render free усыпляет
 * процесс без запросов, и setInterval не срабатывает: этот адрес дёргает внешний cron
 * каждые 5–10 минут (заодно будит сервер).
 */
const router = Router();

router.post('/tick', asyncHandler(async (req: Request, res: Response) => {
  assertInternalToken(req);
  const result = await runMobileTick();
  kickAudioQueue();
  res.json({ ok: true, ...result });
}));

export default router;
