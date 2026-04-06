import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import prisma from '../../lib/prisma';
import { telegramService } from './telegram.service';

const router = Router();

// POST /api/telegram/link — generate link token & deep-link URL
router.post('/link', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const token = telegramService.generateLinkToken(userId);
  const botUsername = telegramService.getBotUsername();

  if (!botUsername) {
    res.status(503).json({ error: 'Telegram бот не запущен' });
    return;
  }

  const deepLink = `https://t.me/${botUsername}?start=${token}`;
  res.json({ deepLink, botUsername });
});

// DELETE /api/telegram/unlink — remove telegramChatId
router.delete('/unlink', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  await prisma.user.update({
    where: { id: userId },
    data: { telegramChatId: null },
  });
  res.json({ success: true });
});

// GET /api/telegram/status — check if linked
router.get('/status', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true },
  });
  res.json({
    linked: !!user?.telegramChatId,
    botUsername: telegramService.getBotUsername(),
  });
});

// POST /api/telegram/test-group-notifications — тест сообщений в группы (ADMIN / SUPER_ADMIN)
router.post(
  '/test-group-notifications',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const results = await telegramService.sendTestGroupMessages();
      const allOk = results.length > 0 && results.every((r) => r.ok);
      res.json({
        ok: allOk,
        message: allOk
          ? 'Все настроенные группы получили тестовое сообщение.'
          : 'Часть каналов не настроена или Telegram вернул ошибку — см. results.',
        results,
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
