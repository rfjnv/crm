import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { AppError } from '../../lib/errors';
import { hasRole } from '../../lib/roles';
import { PERMISSIONS } from '../../lib/permissions';
import { asyncHandler } from '../../lib/asyncHandler';
import { getMarketComparison } from './market.service';

const router = Router();

router.use(authenticate);
// Админам — всегда; остальным — по праву «Анализ рынка» (цены конкурентов без выручки и маржи).
router.use((req, _res, next) => {
  if (!req.user) throw new AppError(401, 'Не авторизован');
  if (hasRole(req.user, 'SUPER_ADMIN', 'ADMIN') || (req.user.permissions ?? []).includes(PERMISSIONS.VIEW_MARKET_ANALYSIS)) return next();
  throw new AppError(403, 'Недостаточно прав');
});

router.get(
  '/comparison',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await getMarketComparison());
  }),
);

export default router;
