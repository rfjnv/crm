import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import prisma from '../../lib/prisma';

export const reviewsRoutes = Router();

reviewsRoutes.use(authenticate);

reviewsRoutes.get('/', async (req, res, next) => {
  try {
    const comments = await prisma.dealComment.findMany({
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
              }
            },
            manager: {
              select: {
                id: true,
                fullName: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    const reviews = comments.map(c => {
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
      };
    });

    res.json(reviews);
  } catch (err) {
    next(err);
  }
});
