import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { listBlockingEvents } from './blocking-events.service';

const router = Router();
router.use(authenticate);

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  country: z.union([z.string(), z.array(z.string())]).optional(),
});

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

router.get(
  '/blocking-events',
  requirePermission('view_import_orders'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    const today = new Date();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));

    const countries = Array.isArray(q.country)
      ? q.country
      : q.country
      ? q.country.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;

    const data = listBlockingEvents({
      from: q.from ?? dateOnly(monthStart),
      to: q.to ?? dateOnly(monthEnd),
      countries,
    });

    res.json(data);
  }),
);

export default router;
