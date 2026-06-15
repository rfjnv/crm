import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import prisma from '../../lib/prisma';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(async (_req, res) => {
  const companies = await prisma.company.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(companies);
}));

router.post('/', authorize('SUPER_ADMIN'), asyncHandler(async (req, res) => {
  const { name, displayName } = req.body as { name: string; displayName: string };
  const company = await prisma.company.create({ data: { name, displayName } });
  res.status(201).json(company);
}));

export default router;
