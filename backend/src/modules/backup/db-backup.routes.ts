import { Router, Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { runAndSendDailyBackup } from './db-backup.service';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

/**
 * Ручной запуск бэкапа (кроме ночного автоматического) — чтобы проверить,
 * что доставка в Telegram работает, не дожидаясь расписания.
 * Монтируется под authenticate + authorize('SUPER_ADMIN') в app.ts.
 */
router.post('/run', async (_req, res) => {
  const result = await runAndSendDailyBackup();
  if (!result.ok) {
    res.status(500).json({ error: result.error ?? 'Бэкап не удался' });
    return;
  }
  res.json({ ok: true, message: 'Бэкап отправлен в Telegram' });
});

export default router;

function assertInternalToken(req: Request): void {
  const expected = config.reports.internalToken;
  if (!expected) {
    throw new AppError(503, 'INTERNAL_REPORTS_TOKEN не настроен на сервере');
  }
  const provided = String(req.header('x-internal-token') || '');
  if (!provided) {
    throw new AppError(401, 'Неверный internal token');
  }
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.alloc(expectedBuf.length);
  providedBuf.write(provided.slice(0, expectedBuf.length));
  if (!timingSafeEqual(expectedBuf, providedBuf) || provided.length !== expected.length) {
    throw new AppError(401, 'Неверный internal token');
  }
}

const internalRouter = Router();

/**
 * Триггер для внешнего cron (например cron-job.org) — бесплатный тариф Render
 * "засыпает" без входящих запросов, поэтому внутренний setInterval-планировщик
 * (db-backup.scheduler.ts) может не сработать ночью, если сервис в это время спит.
 * Внешний HTTP-запрос одновременно будит сервис и надёжно запускает бэкап.
 * Не монтируется под authenticate — защищён отдельным токеном INTERNAL_REPORTS_TOKEN
 * (тот же, что уже используется для /api/internal/reports).
 */
internalRouter.post(
  '/trigger',
  asyncHandler(async (req, res) => {
    assertInternalToken(req);
    const result = await runAndSendDailyBackup();
    res.json({ ok: result.ok, error: result.error, sentAt: new Date().toISOString() });
  }),
);

export { internalRouter as internalBackupRoutes };
