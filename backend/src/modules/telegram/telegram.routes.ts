import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
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

export default router;
