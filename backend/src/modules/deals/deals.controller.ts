import { Request, Response } from 'express';
import { DealStatus, PaymentStatus, Role } from '@prisma/client';
import { dealsService } from './deals.service';
import { AuthUser } from '../../lib/scope';

const PAYMENT_STATUS_QUERY = new Set<PaymentStatus>(['UNPAID', 'PARTIAL', 'PAID']);

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

export class DealsController {
  async findAll(req: Request, res: Response): Promise<void> {
    const status = req.query.status as DealStatus | undefined;
    const includeClosed = req.query.includeClosed === 'true';
    const paymentStatusRaw = req.query.paymentStatus as string | undefined;
    const paymentStatus =
      paymentStatusRaw && PAYMENT_STATUS_QUERY.has(paymentStatusRaw as PaymentStatus)
        ? (paymentStatusRaw as PaymentStatus)
        : undefined;
    const managerId = typeof req.query.managerId === 'string' && req.query.managerId ? req.query.managerId : undefined;
    const closedFrom =
      typeof req.query.closedFrom === 'string' && req.query.closedFrom ? new Date(req.query.closedFrom) : undefined;
    const closedTo =
      typeof req.query.closedTo === 'string' && req.query.closedTo ? new Date(req.query.closedTo) : undefined;
    const deals = await dealsService.findAll(getUser(req), {
      status,
      includeClosed,
      paymentStatus,
      managerId,
      closedFrom: closedFrom && !Number.isNaN(closedFrom.getTime()) ? closedFrom : undefined,
      closedTo: closedTo && !Number.isNaN(closedTo.getTime()) ? closedTo : undefined,
    });
    res.json(deals);
  }

  async findById(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.findById(req.params.id as string, getUser(req));
    res.json(deal);
  }

  async create(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.create(req.body, getUser(req));
    res.status(201).json(deal);
  }

  async update(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.update(req.params.id as string, req.body, getUser(req));
    res.json(deal);
  }

  async updatePayment(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.updatePayment(req.params.id as string, req.body, getUser(req));
    res.json(deal);
  }

  async archive(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.archive(req.params.id as string, getUser(req));
    res.json(deal);
  }

  async unarchive(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.unarchive(req.params.id as string, getUser(req));
    res.json(deal);
  }

  async findArchived(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findArchived(getUser(req));
    res.json(deals);
  }

  async getHistory(req: Request, res: Response): Promise<void> {
    const history = await dealsService.getHistory(req.params.id as string, getUser(req));
    res.json(history);
  }

  async getLogs(req: Request, res: Response): Promise<void> {
    const logs = await dealsService.getLogs(req.params.id as string, getUser(req));
    res.json(logs);
  }

  async addComment(req: Request, res: Response): Promise<void> {
    const comment = await dealsService.addComment(req.params.id as string, req.body, getUser(req));
    res.status(201).json(comment);
  }

  async getComments(req: Request, res: Response): Promise<void> {
    const comments = await dealsService.getComments(req.params.id as string, getUser(req));
    res.json(comments);
  }

  // Deal Items
  async getItems(req: Request, res: Response): Promise<void> {
    const items = await dealsService.getItems(req.params.id as string, getUser(req));
    res.json(items);
  }

  async addItem(req: Request, res: Response): Promise<void> {
    const item = await dealsService.addItem(req.params.id as string, req.body, getUser(req));
    res.status(201).json(item);
  }

  async removeItem(req: Request, res: Response): Promise<void> {
    const result = await dealsService.removeItem(req.params.id as string, req.params.itemId as string, getUser(req));
    res.json(result);
  }

  // Workflow: Warehouse Response
  async submitWarehouseResponse(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.submitWarehouseResponse(req.params.id as string, req.body, getUser(req));
    res.json(deal);
  }

  // Workflow: Set Item Quantities
  async setItemQuantities(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.setItemQuantities(req.params.id as string, req.body, getUser(req));
    res.json(deal);
  }

  async findForStockConfirmation(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findForStockConfirmation(getUser(req));
    res.json(deals);
  }

  // Workflow: Send to Finance (payment method selection)
  async sendToFinance(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.sendToFinance(req.params.id as string, req.body, getUser(req));
    res.json(deal);
  }

  // Workflow: Finance
  async findForFinanceReview(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findForFinanceReview(getUser(req));
    res.json(deals);
  }

  async approveFinance(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.approveFinance(req.params.id as string, getUser(req));
    res.json(deal);
  }

  async rejectFinance(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.rejectFinance(req.params.id as string, req.body, getUser(req));
    res.json(deal);
  }

  // Workflow: Admin Approve
  async approveAdmin(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.approveAdmin(req.params.id as string, getUser(req));
    res.json(deal);
  }

  // Workflow: Deal Approval (after shipment)
  async findForDealApproval(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findForDealApproval(getUser(req));
    res.json(deals);
  }

  async approveDeal(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.approveDeal(req.params.id as string, getUser(req));
    res.json(deal);
  }

  async rejectDeal(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.rejectDeal(req.params.id as string, req.body.reason, getUser(req));
    res.json(deal);
  }

  // Workflow: Shipment
  async findForShipment(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findForShipment(getUser(req));
    res.json(deals);
  }

  async findShipments(req: Request, res: Response): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const todayOnly = req.query.today === '1' || req.query.today === 'true';
    const shipments = await dealsService.findShipments(getUser(req), { page, limit, todayOnly });
    res.json(shipments);
  }

  async findClosedDeals(req: Request, res: Response): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const result = await dealsService.findClosedDeals(getUser(req), { page, limit });
    res.json(result);
  }

  async getAllDealsWithShipmentInfo(req: Request, res: Response): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const deals = await dealsService.getAllDealsWithShipmentInfo(getUser(req), { page, limit });
    res.json(deals);
  }

  async submitShipment(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.submitShipment(req.params.id as string, req.body, getUser(req));
    res.json(deal);
  }

  async getShipment(req: Request, res: Response): Promise<void> {
    const data = await dealsService.getShipment(req.params.id as string, getUser(req));
    res.json(data);
  }

  async holdShipment(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.holdShipment(req.params.id as string, req.body, getUser(req));
    res.json(deal);
  }

  async releaseShipmentHold(req: Request, res: Response): Promise<void> {
    const deal = await dealsService.releaseShipmentHold(req.params.id as string, getUser(req));
    res.json(deal);
  }

  // Payment Records
  async createPaymentRecord(req: Request, res: Response): Promise<void> {
    const payment = await dealsService.createPaymentRecord(req.params.id as string, req.body, getUser(req));
    res.status(201).json(payment);
  }

  async updatePaymentRecord(req: Request, res: Response): Promise<void> {
    const payment = await dealsService.updatePaymentRecord(req.params.id as string, req.params.paymentId as string, req.body, getUser(req));
    res.json(payment);
  }

  async deletePaymentRecord(req: Request, res: Response): Promise<void> {
    await dealsService.deletePaymentRecord(req.params.id as string, req.params.paymentId as string, getUser(req));
    res.json({ ok: true });
  }

  async getDealPayments(req: Request, res: Response): Promise<void> {
    const payments = await dealsService.getDealPayments(req.params.id as string, getUser(req));
    res.json(payments);
  }

  // ── New workflow: Warehouse Manager / Loading / Delivery ──

  async findForWarehouseManager(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findForWarehouseManager(getUser(req));
    res.json(deals);
  }

  async findApprovedForLoading(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findApprovedForLoading(getUser(req));
    res.json(deals);
  }

  async findForDeliveryAssignment(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findForDeliveryAssignment(getUser(req));
    res.json(deals);
  }

  async findMyLoadingTasks(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findMyLoadingTasks(getUser(req));
    res.json(deals);
  }

  async findMyVehicle(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findMyVehicle(getUser(req));
    res.json(deals);
  }

  async warehouseManagerConfirm(req: Request, res: Response): Promise<void> {
    await dealsService.warehouseManagerConfirm(req.params.id as string, getUser(req));
    res.json({ ok: true });
  }

  async approveByAdmin(req: Request, res: Response): Promise<void> {
    await dealsService.approveByAdmin(req.params.id as string, getUser(req));
    res.json({ ok: true });
  }

  async rejectByAdmin(req: Request, res: Response): Promise<void> {
    await dealsService.rejectByAdmin(req.params.id as string, req.body.reason, getUser(req));
    res.json({ ok: true });
  }

  async assignLoading(req: Request, res: Response): Promise<void> {
    await dealsService.assignLoading(req.params.id as string, req.body, getUser(req));
    res.json({ ok: true });
  }

  async markLoaded(req: Request, res: Response): Promise<void> {
    await dealsService.markLoaded(req.params.id as string, getUser(req));
    res.json({ ok: true });
  }

  async assignDriver(req: Request, res: Response): Promise<void> {
    await dealsService.assignDriver(req.params.id as string, req.body, getUser(req));
    res.json({ ok: true });
  }

  async startDelivery(req: Request, res: Response): Promise<void> {
    const result = await dealsService.startDelivery(req.body, getUser(req));
    res.json(result);
  }

  async deliverDeal(req: Request, res: Response): Promise<void> {
    await dealsService.deliverDeal(req.params.id as string, getUser(req));
    res.json({ ok: true });
  }

  async getLoadingStaff(_req: Request, res: Response): Promise<void> {
    const staff = await dealsService.getLoadingStaff();
    res.json(staff);
  }

  async getDrivers(_req: Request, res: Response): Promise<void> {
    const drivers = await dealsService.getDrivers();
    res.json(drivers);
  }

  async findPendingAdmin(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findPendingAdmin(getUser(req));
    res.json(deals);
  }
}

export const dealsController = new DealsController();
