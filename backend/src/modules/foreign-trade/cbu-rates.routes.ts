import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { fetchCbuRates, type NormalizedRate } from './cbu-client';

interface CachedPayload {
  fetchedAt: string;
  date: string | null;
  rates: NormalizedRate[];
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { payload: CachedPayload; expiresAt: number } | null = null;

async function getCached(): Promise<CachedPayload> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.payload;
  }
  const rates = await fetchCbuRates();
  const payload: CachedPayload = {
    fetchedAt: new Date().toISOString(),
    date: rates[0]?.rawDate ?? null,
    rates,
  };
  cache = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
  return payload;
}

const router = Router();
router.use(authenticate);

router.get(
  '/cbu-rates',
  requirePermission('view_import_orders'),
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const payload = await getCached();
      res.json(payload);
    } catch (err) {
      if (cache) {
        res.json({ ...cache.payload, stale: true });
        return;
      }
      const message = err instanceof Error ? err.message : 'unknown';
      res.status(502).json({ error: `Не удалось получить курсы ЦБ: ${message}` });
    }
  }),
);

export default router;
