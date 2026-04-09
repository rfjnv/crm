import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import prisma from '../../lib/prisma';

export const reviewsRoutes = Router();

reviewsRoutes.use(authenticate);

reviewsRoutes.get('/', async (req, res, next) => {
  try {
    const [comments, deliveryRatings] = await Promise.all([
      prisma.dealComment.findMany({
        where: {
          text: { startsWith: 'Отзыв клиента из Telegram:' },
        },
        include: {
          deal: {
            select: {
              id: true,
              title: true,
              client: {
                select: {
                  id: true,
                  contactName: true,
                  phone: true,
                },
              },
              manager: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.dealRating.findMany({
        where: {
          ratedAt: { not: null },
          rating: { not: null },
        },
        include: {
          deal: {
            select: {
              id: true,
              title: true,
              client: {
                select: {
                  id: true,
                  contactName: true,
                  phone: true,
                },
              },
              manager: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
            },
          },
        },
        orderBy: { ratedAt: 'desc' },
      }),
    ]);

    const telegram = comments.map((c) => {
      let rating = 0;
      let text = '';

      const ratingMatch = c.text.match(/Отзыв клиента из Telegram:\s*(\d+)\/5/);
      if (ratingMatch) rating = parseInt(ratingMatch[1], 10);

      const textMatch = c.text.match(/Текст:\s*([\s\S]*)$/);
      if (textMatch) text = textMatch[1].trim();

      return {
        id: c.id,
        createdAt: c.createdAt,
        rating,
        text,
        deal: c.deal,
        channel: 'telegram' as const,
        channelLabel: 'Telegram',
      };
    });

    const delivery = deliveryRatings.map((r) => ({
      id: r.id,
      createdAt: r.ratedAt!,
      rating: r.rating!,
      text: (r.comment ?? '').trim(),
      deal: r.deal,
      channel: 'delivery' as const,
      channelLabel: 'После доставки (QR)',
    }));

    res.json({ telegram, delivery });
  } catch (err) {
    next(err);
  }
});
