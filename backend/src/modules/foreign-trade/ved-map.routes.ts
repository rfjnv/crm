import { Router } from 'express';
import { vedMapController } from './ved-map.controller';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  createSupplierSiteDto,
  createVedMapRouteDto,
  updateSupplierSiteDto,
  updateVedMapRouteDto,
} from './ved-map.dto';

const router = Router();

router.use(authenticate);

router.get(
  '/map/sites',
  requirePermission('view_import_orders'),
  asyncHandler(vedMapController.listSites.bind(vedMapController)),
);

router.post(
  '/map/sites',
  requirePermission('manage_suppliers'),
  validate(createSupplierSiteDto),
  asyncHandler(vedMapController.createSite.bind(vedMapController)),
);

router.patch(
  '/map/sites/:id',
  requirePermission('manage_suppliers'),
  validate(updateSupplierSiteDto),
  asyncHandler(vedMapController.updateSite.bind(vedMapController)),
);

router.delete(
  '/map/sites/:id',
  requirePermission('manage_suppliers'),
  asyncHandler(vedMapController.deleteSite.bind(vedMapController)),
);

router.get(
  '/map/routes',
  requirePermission('view_import_orders'),
  asyncHandler(vedMapController.listRoutes.bind(vedMapController)),
);

router.post(
  '/map/routes',
  requirePermission('manage_suppliers'),
  validate(createVedMapRouteDto),
  asyncHandler(vedMapController.createRoute.bind(vedMapController)),
);

router.patch(
  '/map/routes/:id',
  requirePermission('manage_suppliers'),
  validate(updateVedMapRouteDto),
  asyncHandler(vedMapController.updateRoute.bind(vedMapController)),
);

router.delete(
  '/map/routes/:id',
  requirePermission('manage_suppliers'),
  asyncHandler(vedMapController.deleteRoute.bind(vedMapController)),
);

export default router;
