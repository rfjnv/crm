import { Router } from 'express';
import { suppliersController } from './suppliers.controller';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createSupplierDto, updateSupplierDto } from './suppliers.dto';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('view_import_orders'),
  asyncHandler(suppliersController.findAll.bind(suppliersController)),
);

router.get(
  '/:id',
  requirePermission('view_import_orders'),
  asyncHandler(suppliersController.findById.bind(suppliersController)),
);

router.post(
  '/',
  requirePermission('manage_suppliers'),
  validate(createSupplierDto),
  asyncHandler(suppliersController.create.bind(suppliersController)),
);

router.patch(
  '/:id',
  requirePermission('manage_suppliers'),
  validate(updateSupplierDto),
  asyncHandler(suppliersController.update.bind(suppliersController)),
);

router.post(
  '/:id/archive',
  requirePermission('manage_suppliers'),
  asyncHandler(suppliersController.archive.bind(suppliersController)),
);

export default router;
