import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { exchangeRatesService } from './exchange-rates.service';

const router = Router();
router.use(authenticate);

const listQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  currency: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

router.get(
  '/exchange-rates',
  requirePermission('view_import_orders'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    const rows = await exchangeRatesService.listRange({
      from: q.from,
      to: q.to,
      currencies: q.currency ? [q.currency] : undefined,
      limit: q.limit,
    });
    res.json(rows);
  }),
);

const findQuery = z.object({
  date: z.string(),
  currency: z.string(),
});

router.get(
  '/exchange-rates/find',
  requirePermission('view_import_orders'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = findQuery.parse(req.query);
    const found = await exchangeRatesService.findRate(q.date, q.currency);
    if (!found) {
      res.status(404).json({ error: `Курс ${q.currency} на ${q.date} не найден` });
      return;
    }
    res.json(found);
  }),
);

router.post(
  '/exchange-rates/sync',
  requirePermission('manage_import_orders'),
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await exchangeRatesService.syncFromCbu();
    res.json(result);
  }),
);

export default router;
