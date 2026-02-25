import { Router } from 'express';
import multer from 'multer';
import { warehouseController } from './warehouse.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize, requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createProductDto, updateProductDto, createMovementDto, correctStockDto } from './warehouse.dto';

const router = Router();

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.originalname.endsWith('.xlsx') ||
        file.originalname.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Допустимы только файлы Excel (.xlsx, .xls)'));
    }
  },
});

router.use(authenticate);

// Products
router.get('/products', asyncHandler(warehouseController.findAllProducts.bind(warehouseController)));
router.post('/products', requirePermission('manage_products'), validate(createProductDto), asyncHandler(warehouseController.createProduct.bind(warehouseController)));
router.patch('/products/:id', requirePermission('manage_products'), validate(updateProductDto), asyncHandler(warehouseController.updateProduct.bind(warehouseController)));
router.delete('/products/:id', requirePermission('manage_products'), asyncHandler(warehouseController.deleteProduct.bind(warehouseController)));
router.post('/products/:id/correct-stock', authorize('SUPER_ADMIN'), validate(correctStockDto), asyncHandler(warehouseController.correctStock.bind(warehouseController)));
router.get('/products/:id/movements', asyncHandler(warehouseController.getProductMovements.bind(warehouseController)));
router.get('/products/:id/analytics', asyncHandler(warehouseController.getProductAnalytics.bind(warehouseController)));

// Movements — warehouse roles + admin
router.post('/movements', requirePermission('create_inventory_in'), validate(createMovementDto), asyncHandler(warehouseController.createMovement.bind(warehouseController)));
router.get('/movements', asyncHandler(warehouseController.getMovements.bind(warehouseController)));

// Import
router.post('/import-excel',
  requirePermission('manage_products', 'create_inventory_in'),
  upload.single('file'),
  asyncHandler(warehouseController.importProductsFromExcel.bind(warehouseController))
);

export default router;
