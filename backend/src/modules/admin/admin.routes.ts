import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../../middleware/authenticate';
import { authorize, requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { superOverrideDealDto, superDeleteDealDto } from '../deals/deals.dto';
import { dealsService } from '../deals/deals.service';
import { warehouseService } from '../warehouse/warehouse.service';
import { AuthUser } from '../../lib/scope';

const router = Router();

router.use(authenticate);

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

// ──── SUPER_ADMIN Deal Override ────
router.patch(
  '/deals/:id/override',
  authorize('SUPER_ADMIN', 'ADMIN'),
  validate(superOverrideDealDto),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dealsService.overrideUpdate(req.params.id as string, req.body, getUser(req));
    res.json(result);
  }),
);

// ──── SUPER_ADMIN Hard Delete Deal ────
router.delete(
  '/deals/:id',
  requirePermission('delete_any_deal'),
  validate(superDeleteDealDto),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dealsService.hardDelete(req.params.id as string, req.body.reason, getUser(req));
    res.json(result);
  }),
);

// ──── SUPER_ADMIN Audit History ────
router.get(
  '/deals/:id/audit',
  requirePermission('view_audit_history'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dealsService.getAuditHistory(req.params.id as string);
    res.json(result);
  }),
);

// ──── SUPER_ADMIN Product Audit History ────
router.get(
  '/products/audit',
  requirePermission('view_audit_history'),
  asyncHandler(async (req: Request, res: Response) => {
    const productId = req.query.productId as string | undefined;
    const result = await warehouseService.getProductAuditHistory(productId);
    res.json(result);
  }),
);

export { router as adminRoutes };
