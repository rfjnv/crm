import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';

const router = Router();

function normalizeToken(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) return value[0];
  return null;
}

router.get('/:token', async (req: Request, res: Response) => {
  try {
    const token = normalizeToken(req.params.token);
    if (!token) {
      res.status(400).json({ error: 'Некорректный токен' });
      return;
    }

    const rating = await prisma.dealRating.findUnique({
      where: { token },
    });

    if (!rating) {
      res.status(404).json({ error: 'Ссылка не найдена' });
      return;
    }

    const deal = await prisma.deal.findUnique({
      where: { id: rating.dealId },
      select: {
        title: true,
        createdAt: true,
        deliveryDriver: { select: { fullName: true } },
        loadingAssignee: { select: { fullName: true } },
      },
    });

    if (!deal) {
      res.status(404).json({ error: 'Сделка не найдена' });
      return;
    }

    res.json({
      dealTitle: deal.title,
      dealDate: deal.createdAt,
      driverName: deal.deliveryDriver?.fullName ?? null,
      loaderName: deal.loadingAssignee?.fullName ?? null,
      alreadyRated: !!rating.ratedAt,
      rating: rating.rating,
    });
  } catch (err) {
    console.error('Public rating GET error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/:token', async (req: Request, res: Response) => {
  try {
    const token = normalizeToken(req.params.token);
    if (!token) {
      res.status(400).json({ error: 'Некорректный токен' });
      return;
    }

    const { rating, comment } = req.body;

    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
      return;
    }

    const existing = await prisma.dealRating.findUnique({ where: { token } });

    if (!existing) {
      res.status(404).json({ error: 'Ссылка не найдена' });
      return;
    }

    if (existing.ratedAt) {
      res.status(400).json({ error: 'Вы уже оценили эту доставку' });
      return;
    }

    await prisma.dealRating.update({
      where: { token },
      data: {
        rating,
        comment: comment ? String(comment).slice(0, 500) : null,
        ratedAt: new Date(),
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Public rating POST error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
