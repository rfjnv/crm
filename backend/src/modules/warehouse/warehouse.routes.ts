import { Router } from 'express';
import { warehouseController } from './warehouse.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize, requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createProductDto, updateProductDto, createMovementDto } from './warehouse.dto';

const router = Router();

router.use(authenticate);

// Products
router.get('/products', asyncHandler(warehouseController.findAllProducts.bind(warehouseController)));
router.post('/products', requirePermission('manage_products'), validate(createProductDto), asyncHandler(warehouseController.createProduct.bind(warehouseController)));
router.patch('/products/:id', requirePermission('manage_products'), validate(updateProductDto), asyncHandler(warehouseController.updateProduct.bind(warehouseController)));
router.get('/products/:id/movements', asyncHandler(warehouseController.getProductMovements.bind(warehouseController)));

// Movements — ADMIN only for direct creation
router.post('/movements', authorize('ADMIN'), validate(createMovementDto), asyncHandler(warehouseController.createMovement.bind(warehouseController)));
router.get('/movements', asyncHandler(warehouseController.getMovements.bind(warehouseController)));

export default router;
