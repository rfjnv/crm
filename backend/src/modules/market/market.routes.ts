import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { getMarketComparison } from './market.service';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN'));

router.get(
  '/comparison',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getMarketComparison({ kind: 'viewer', role: req.user!.role, companyId: req.user!.companyId }));
  }),
);

export default router;
