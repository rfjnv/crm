import { Router } from 'express';
import multer from 'multer';
import { warehouseController } from './warehouse.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize, requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createProductDto, updateProductDto, createMovementDto, correctStockDto, createReservationDto } from './warehouse.dto';

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

// Фото товаров (главное фото + постеры) уходят в Supabase Storage, а не на диск —
// на Render free plan локальные файлы бэкенда пропадают при каждом деплое/рестарте.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Допустимы только изображения'));
  },
});

const posterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Допустимы только изображения'));
  },
});

router.use(authenticate);

// Products
router.get('/products', asyncHandler(warehouseController.findAllProducts.bind(warehouseController)));
router.post('/products', requirePermission('manage_products'), validate(createProductDto), asyncHandler(warehouseController.createProduct.bind(warehouseController)));
router.get('/products/stock-as-of', asyncHandler(warehouseController.getStockAsOf.bind(warehouseController)));
router.get('/products/stock-export', asyncHandler(warehouseController.exportStock.bind(warehouseController)));
router.get('/products/:id', asyncHandler(warehouseController.findProductById.bind(warehouseController)));
router.patch('/products/:id', requirePermission('manage_products'), validate(updateProductDto), asyncHandler(warehouseController.updateProduct.bind(warehouseController)));
router.delete('/products/:id', requirePermission('manage_products'), asyncHandler(warehouseController.deleteProduct.bind(warehouseController)));
router.post('/products/:id/correct-stock', authorize('SUPER_ADMIN'), validate(correctStockDto), asyncHandler(warehouseController.correctStock.bind(warehouseController)));
router.post('/products/:id/image', imageUpload.single('image'), asyncHandler(warehouseController.uploadProductImage.bind(warehouseController)));
router.post('/products/:id/photos', requirePermission('manage_products'), posterUpload.array('images', 30), asyncHandler(warehouseController.uploadProductPhotos.bind(warehouseController)));
router.delete('/products/:id/photos/:photoId', requirePermission('manage_products'), asyncHandler(warehouseController.deleteProductPhoto.bind(warehouseController)));
router.get('/products/:id/movements', asyncHandler(warehouseController.getProductMovements.bind(warehouseController)));
router.get('/products/:id/analytics', asyncHandler(warehouseController.getProductAnalytics.bind(warehouseController)));

// Reservations — managers can book stock for a client until a date
router.post('/reservations', requirePermission('manage_inventory'), validate(createReservationDto), asyncHandler(warehouseController.createReservation.bind(warehouseController)));
router.get('/reservations', asyncHandler(warehouseController.listReservations.bind(warehouseController)));
router.post('/reservations/:id/cancel', requirePermission('manage_inventory'), asyncHandler(warehouseController.cancelReservation.bind(warehouseController)));
router.post('/reservations/:id/fulfill', requirePermission('manage_inventory'), asyncHandler(warehouseController.fulfillReservation.bind(warehouseController)));
router.get('/products/:id/reservations', asyncHandler(warehouseController.getProductReservations.bind(warehouseController)));

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
