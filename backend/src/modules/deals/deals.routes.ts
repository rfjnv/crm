import { Router } from 'express';
import { dealsController } from './deals.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  createDealDto, updateDealDto, createCommentDto, paymentDto,
  addDealItemDto, warehouseResponseDto, setItemQuantitiesDto,
  shipmentDto, financeRejectDto,
  createPaymentRecordDto, shipmentHoldDto,
} from './deals.dto';

const router = Router();

router.use(authenticate);

// Workflow Queues (MUST be before /:id to avoid param conflicts)
router.get('/finance-queue', authorize('ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForFinanceReview.bind(dealsController)));
router.get('/shipment-queue', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForShipment.bind(dealsController)));
router.get('/stock-confirmation-queue', authorize('WAREHOUSE', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForStockConfirmation.bind(dealsController)));

router.get('/', asyncHandler(dealsController.findAll.bind(dealsController)));
router.get('/:id', asyncHandler(dealsController.findById.bind(dealsController)));
router.post('/', validate(createDealDto), asyncHandler(dealsController.create.bind(dealsController)));
router.patch('/:id', validate(updateDealDto), asyncHandler(dealsController.update.bind(dealsController)));
router.patch('/:id/payment', validate(paymentDto), asyncHandler(dealsController.updatePayment.bind(dealsController)));
router.patch('/:id/archive', asyncHandler(dealsController.archive.bind(dealsController)));
router.get('/:id/logs', asyncHandler(dealsController.getLogs.bind(dealsController)));
router.get('/:id/history', asyncHandler(dealsController.getHistory.bind(dealsController)));
router.post('/:id/comments', validate(createCommentDto), asyncHandler(dealsController.addComment.bind(dealsController)));
router.get('/:id/comments', asyncHandler(dealsController.getComments.bind(dealsController)));

// Deal Items
router.get('/:id/items', asyncHandler(dealsController.getItems.bind(dealsController)));
router.post('/:id/items', validate(addDealItemDto), asyncHandler(dealsController.addItem.bind(dealsController)));
router.delete('/:id/items/:itemId', asyncHandler(dealsController.removeItem.bind(dealsController)));

// Workflow: Warehouse Response
router.post('/:id/stock-confirm', authorize('WAREHOUSE', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), validate(warehouseResponseDto), asyncHandler(dealsController.submitWarehouseResponse.bind(dealsController)));

// Workflow: Set Item Quantities (Manager fills after warehouse response)
router.post('/:id/set-quantities', authorize('MANAGER', 'ADMIN', 'SUPER_ADMIN'), validate(setItemQuantitiesDto), asyncHandler(dealsController.setItemQuantities.bind(dealsController)));

// Workflow: Finance
router.post('/:id/finance-approve', asyncHandler(dealsController.approveFinance.bind(dealsController)));
router.post('/:id/finance-reject', validate(financeRejectDto), asyncHandler(dealsController.rejectFinance.bind(dealsController)));

// Workflow: Admin Approve
router.post('/:id/admin-approve', asyncHandler(dealsController.approveAdmin.bind(dealsController)));

// Workflow: Shipment
router.post('/:id/shipment', validate(shipmentDto), asyncHandler(dealsController.submitShipment.bind(dealsController)));
router.get('/:id/shipment', asyncHandler(dealsController.getShipment.bind(dealsController)));
router.post('/:id/shipment-hold', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), validate(shipmentHoldDto), asyncHandler(dealsController.holdShipment.bind(dealsController)));
router.post('/:id/shipment-release', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.releaseShipmentHold.bind(dealsController)));

// Payment Records
router.post('/:id/payments', validate(createPaymentRecordDto), asyncHandler(dealsController.createPaymentRecord.bind(dealsController)));
router.get('/:id/payments', asyncHandler(dealsController.getDealPayments.bind(dealsController)));

export default router;
