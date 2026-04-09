import { Router } from 'express';
import { dealsController } from './deals.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import {
  createDealDto, updateDealDto, createCommentDto, paymentDto,
  addDealItemDto, warehouseResponseDto, setItemQuantitiesDto,
  shipmentDto, financeRejectDto, sendToFinanceDto,
  createPaymentRecordDto, updatePaymentRecordDto, shipmentHoldDto,
  assignLoadingDto, assignDriverDto, startDeliveryDto,
} from './deals.dto';

const router = Router();

router.use(authenticate);

// Workflow Queues (MUST be before /:id to avoid param conflicts)
router.get('/finance-queue', authorize('ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForFinanceReview.bind(dealsController)));
router.get('/shipment-queue', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForShipment.bind(dealsController)));
router.get('/closed-deals', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findClosedDeals.bind(dealsController)));
router.get('/shipments', authorize('WAREHOUSE', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findShipments.bind(dealsController)));
router.get('/all-deals-debug', authorize('WAREHOUSE', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.getAllDealsWithShipmentInfo.bind(dealsController)));
router.get('/stock-confirmation-queue', authorize('WAREHOUSE', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForStockConfirmation.bind(dealsController)));
router.get('/deal-approval-queue', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForDealApproval.bind(dealsController)));
router.get('/archived', asyncHandler(dealsController.findArchived.bind(dealsController)));

// New workflow queues
router.get('/wm/incoming', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForWarehouseManager.bind(dealsController)));
router.get('/wm/approved', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findApprovedForLoading.bind(dealsController)));
router.get('/wm/delivery', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findForDeliveryAssignment.bind(dealsController)));
router.get('/wm/pending-admin', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findPendingAdmin.bind(dealsController)));
router.get('/loading-staff', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.getLoadingStaff.bind(dealsController)));
router.get('/drivers-list', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.getDrivers.bind(dealsController)));
router.get('/my-loading-tasks', authorize('WAREHOUSE', 'DRIVER', 'LOADER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findMyLoadingTasks.bind(dealsController)));
router.get('/my-vehicle', authorize('DRIVER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.findMyVehicle.bind(dealsController)));
router.post('/start-delivery', authorize('DRIVER', 'ADMIN', 'SUPER_ADMIN'), validate(startDeliveryDto), asyncHandler(dealsController.startDelivery.bind(dealsController)));

router.get('/', asyncHandler(dealsController.findAll.bind(dealsController)));
router.get('/:id', asyncHandler(dealsController.findById.bind(dealsController)));
router.post('/', validate(createDealDto), asyncHandler(dealsController.create.bind(dealsController)));
router.patch('/:id', validate(updateDealDto), asyncHandler(dealsController.update.bind(dealsController)));
router.patch('/:id/payment', validate(paymentDto), asyncHandler(dealsController.updatePayment.bind(dealsController)));
router.patch('/:id/archive', asyncHandler(dealsController.archive.bind(dealsController)));
router.patch('/:id/unarchive', authorize('SUPER_ADMIN', 'ADMIN'), asyncHandler(dealsController.unarchive.bind(dealsController)));
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

// Workflow: Set Item Quantities (Manager fills after warehouse response, accountant may adjust in finance step)
router.post('/:id/set-quantities', authorize('MANAGER', 'ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'), validate(setItemQuantitiesDto), asyncHandler(dealsController.setItemQuantities.bind(dealsController)));

// Workflow: Send to Finance (Manager selects payment method)
router.post('/:id/send-to-finance', authorize('MANAGER', 'ADMIN', 'SUPER_ADMIN'), validate(sendToFinanceDto), asyncHandler(dealsController.sendToFinance.bind(dealsController)));

// Workflow: Finance
router.post('/:id/finance-approve', authorize('ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.approveFinance.bind(dealsController)));
router.post('/:id/finance-reject', authorize('ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'), validate(financeRejectDto), asyncHandler(dealsController.rejectFinance.bind(dealsController)));

// Workflow: Admin Approve
router.post('/:id/admin-approve', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.approveAdmin.bind(dealsController)));

// Workflow: Deal Approval (after shipment)
router.post('/:id/deal-approve', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.approveDeal.bind(dealsController)));
router.post('/:id/deal-reject', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.rejectDeal.bind(dealsController)));

// Workflow: Shipment
router.post('/:id/shipment', validate(shipmentDto), asyncHandler(dealsController.submitShipment.bind(dealsController)));
router.get('/:id/shipment', asyncHandler(dealsController.getShipment.bind(dealsController)));
router.post('/:id/shipment-hold', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), validate(shipmentHoldDto), asyncHandler(dealsController.holdShipment.bind(dealsController)));
router.post('/:id/shipment-release', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.releaseShipmentHold.bind(dealsController)));

// Payment Records
router.post('/:id/payments', validate(createPaymentRecordDto), asyncHandler(dealsController.createPaymentRecord.bind(dealsController)));
router.patch('/:id/payments/:paymentId', validate(updatePaymentRecordDto), asyncHandler(dealsController.updatePaymentRecord.bind(dealsController)));
router.delete('/:id/payments/:paymentId', asyncHandler(dealsController.deletePaymentRecord.bind(dealsController)));
router.get('/:id/payments', asyncHandler(dealsController.getDealPayments.bind(dealsController)));

// New Workflow: per-deal actions
router.post('/:id/wm-confirm', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.warehouseManagerConfirm.bind(dealsController)));
router.post('/:id/admin-approve-new', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.approveByAdmin.bind(dealsController)));
router.post('/:id/admin-reject-new', authorize('ADMIN', 'SUPER_ADMIN'), validate(financeRejectDto), asyncHandler(dealsController.rejectByAdmin.bind(dealsController)));
router.post('/:id/assign-loading', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), validate(assignLoadingDto), asyncHandler(dealsController.assignLoading.bind(dealsController)));
router.post('/:id/mark-loaded', authorize('WAREHOUSE', 'DRIVER', 'LOADER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.markLoaded.bind(dealsController)));
router.post('/:id/assign-driver', authorize('WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'), validate(assignDriverDto), asyncHandler(dealsController.assignDriver.bind(dealsController)));
router.post('/:id/deliver', authorize('DRIVER', 'ADMIN', 'SUPER_ADMIN'), asyncHandler(dealsController.deliverDeal.bind(dealsController)));

export default router;
