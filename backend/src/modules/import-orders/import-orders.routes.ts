import { Router } from 'express';
import multer from 'multer';
import { importOrdersController } from './import-orders.controller';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  createImportOrderDto,
  updateImportOrderDto,
  replaceItemsDto,
  changeStatusDto,
} from './import-orders.dto';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/jpg',
      'application/zip', 'application/x-zip-compressed',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Допустимы только файлы PDF, JPG, PNG, ZIP'));
    }
  },
});

router.use(authenticate);

router.get(
  '/',
  requirePermission('view_import_orders'),
  asyncHandler(importOrdersController.findAll.bind(importOrdersController)),
);

router.get(
  '/:id',
  requirePermission('view_import_orders'),
  asyncHandler(importOrdersController.findById.bind(importOrdersController)),
);

router.get(
  '/:id/landed-cost',
  requirePermission('view_import_orders'),
  asyncHandler(importOrdersController.landedCost.bind(importOrdersController)),
);

router.post(
  '/',
  requirePermission('manage_import_orders'),
  validate(createImportOrderDto),
  asyncHandler(importOrdersController.create.bind(importOrdersController)),
);

router.patch(
  '/:id',
  requirePermission('manage_import_orders'),
  validate(updateImportOrderDto),
  asyncHandler(importOrdersController.update.bind(importOrdersController)),
);

router.put(
  '/:id/items',
  requirePermission('manage_import_orders'),
  validate(replaceItemsDto),
  asyncHandler(importOrdersController.replaceItems.bind(importOrdersController)),
);

router.post(
  '/:id/status',
  requirePermission('manage_import_orders'),
  validate(changeStatusDto),
  asyncHandler(importOrdersController.changeStatus.bind(importOrdersController)),
);

router.post(
  '/:id/attachments',
  requirePermission('manage_import_orders'),
  upload.single('file'),
  asyncHandler(importOrdersController.uploadAttachment.bind(importOrdersController)),
);

router.delete(
  '/:id/attachments/:attachmentId',
  requirePermission('manage_import_orders'),
  asyncHandler(importOrdersController.deleteAttachment.bind(importOrdersController)),
);

export default router;
