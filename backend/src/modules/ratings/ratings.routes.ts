import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';

const router = Router();

router.get('/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const rating = await prisma.dealRating.findUnique({
      where: { token },
      include: {
        deal: {
          select: {
            title: true,
            createdAt: true,
            deliveryDriver: { select: { fullName: true } },
            loadingAssignee: { select: { fullName: true } },
            client: { select: { companyName: true } },
          },
        },
      },
    });

    if (!rating) {
      res.status(404).json({ error: 'Ссылка не найдена' });
      return;
    }

    res.json({
      dealTitle: rating.deal.title,
      dealDate: rating.deal.createdAt,
      driverName: rating.deal.deliveryDriver?.fullName ?? null,
      loaderName: rating.deal.loadingAssignee?.fullName ?? null,
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
    const { token } = req.params;
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
