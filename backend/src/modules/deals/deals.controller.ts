import { Request, Response } from 'express';
import { DealStatus, Role } from '@prisma/client';
import { dealsService } from './deals.service';
import { AuthUser } from '../../lib/scope';

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

export class DealsController {
  async findAll(req: Request, res: Response): Promise<void> {
    const status = req.query.status as DealStatus | undefined;
    const includeClosed = req.query.includeClosed === 'true';
    const deals = await dealsService.findAll(getUser(req), { status, includeClosed });
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

  // Workflow: Shipment
  async findForShipment(req: Request, res: Response): Promise<void> {
    const deals = await dealsService.findForShipment(getUser(req));
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

  async getDealPayments(req: Request, res: Response): Promise<void> {
    const payments = await dealsService.getDealPayments(req.params.id as string, getUser(req));
    res.json(payments);
  }
}

export const dealsController = new DealsController();
