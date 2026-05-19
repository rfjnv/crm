import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { suppliersController } from './suppliers.controller';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { generateStorageName } from '../../lib/uploadSecurity';
import { createSupplierDto, updateSupplierDto } from './suppliers.dto';

const router = Router();

const logoDir = path.resolve(process.cwd(), 'uploads', 'suppliers');

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(logoDir)) {
      fs.mkdirSync(logoDir, { recursive: true });
    }
    cb(null, logoDir);
  },
  filename: (_req, file, cb) => {
    cb(null, generateStorageName(file.originalname));
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Допустимы только JPG, PNG, WEBP, SVG'));
    }
  },
});

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

router.post(
  '/:id/logo',
  requirePermission('manage_suppliers'),
  uploadLogo.single('logo'),
  asyncHandler(suppliersController.uploadLogo.bind(suppliersController)),
);

export default router;
