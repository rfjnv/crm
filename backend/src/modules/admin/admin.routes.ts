import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../../middleware/authenticate';
import { authorize, requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { superOverrideDealDto, superDeleteDealDto } from '../deals/deals.dto';
import { dealsService } from '../deals/deals.service';
import { warehouseService } from '../warehouse/warehouse.service';
import { superCorrectClientStockAddDto, superDeleteClientStockAddDto } from '../clients/clients.dto';
import { clientsService } from '../clients/clients.service';
import { AuthUser } from '../../lib/scope';
import { listAuditLogsForSuperAdmin } from './admin.audit-logs.service';
import { getDailyActivityReport } from '../activity-tracking/activity-tracking.service';

const router = Router();

router.use(authenticate);

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [], companyId: req.user!.companyId };
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

// ──── SUPER_ADMIN: правка поступления на склад клиента (дата/кол-во для аналитики) ────
router.patch(
  '/clients/:clientId/stock/events/:eventId',
  authorize('SUPER_ADMIN'),
  validate(superCorrectClientStockAddDto),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await clientsService.superCorrectClientStockAddEvent(
      req.params.clientId as string,
      req.params.eventId as string,
      req.body,
      getUser(req),
    );
    res.json(result);
  }),
);

router.delete(
  '/clients/:clientId/stock/events/:eventId',
  authorize('SUPER_ADMIN'),
  validate(superDeleteClientStockAddDto),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await clientsService.superDeleteClientStockAddEvent(
      req.params.clientId as string,
      req.params.eventId as string,
      req.body,
      getUser(req),
    );
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

// ──── SUPER_ADMIN: глобальный журнал действий всех пользователей (кто/что/когда/IP/устройство) ────
router.get(
  '/audit-logs',
  requirePermission('view_audit_history'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await listAuditLogsForSuperAdmin({
      userId: req.query.userId as string | undefined,
      entityId: req.query.entityId as string | undefined,
      entityType: req.query.entityType as string | undefined,
      action: req.query.action as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  }),
);

// ──── SUPER_ADMIN: время в системе и просмотры страниц за день ────
router.get(
  '/activity/sessions',
  requirePermission('view_audit_history'),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query.userId as string | undefined;
    const date = req.query.date as string | undefined;
    if (!userId || !date) {
      res.status(400).json({ error: 'userId и date обязательны' });
      return;
    }
    const result = await getDailyActivityReport(userId, date);
    res.json(result);
  }),
);

export { router as adminRoutes };
