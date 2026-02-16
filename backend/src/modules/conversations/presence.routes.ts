import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import prisma from '../../lib/prisma';

const router = Router();

router.use(authenticate);

// Ping — update lastSeenAt
router.post('/ping', asyncHandler(async (req: Request, res: Response) => {
  await prisma.user.update({
    where: { id: req.user!.userId },
    data: { lastSeenAt: new Date() },
  });
  res.json({ ok: true });
}));

// Get online users (lastSeenAt within 60 seconds)
router.get('/online', asyncHandler(async (req: Request, res: Response) => {
  const threshold = new Date(Date.now() - 60_000);
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      lastSeenAt: { gte: threshold },
    },
    select: {
      id: true,
      fullName: true,
      role: true,
      lastSeenAt: true,
    },
    orderBy: { fullName: 'asc' },
  });
  res.json(users);
}));

export default router;
