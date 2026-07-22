import { Router } from 'express';
import { runAndSendDailyBackup } from './db-backup.service';

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
