import { Request, Response } from 'express';
import { DealStatus, Role } from '@prisma/client';
import { clientsService } from './clients.service';
import type { AuthUser } from '../../lib/scope';

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

export class ClientsController {
  async findAll(req: Request, res: Response): Promise<void> {
    const clients = await clientsService.findAll(getUser(req));
    res.json(clients);
  }

  async findById(req: Request, res: Response): Promise<void> {
    const filters = {
      dealStatus: req.query.dealStatus as DealStatus | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    };
    const client = await clientsService.findById(req.params.id as string, getUser(req), filters);
    res.json(client);
  }

  async create(req: Request, res: Response): Promise<void> {
    const client = await clientsService.create(req.body, getUser(req));
    res.status(201).json(client);
  }

  async update(req: Request, res: Response): Promise<void> {
    const client = await clientsService.update(req.params.id as string, req.body, getUser(req));
    res.json(client);
  }

  async archive(req: Request, res: Response): Promise<void> {
    const client = await clientsService.archive(req.params.id as string, getUser(req));
    res.json(client);
  }

  async getHistory(req: Request, res: Response): Promise<void> {
    const history = await clientsService.getHistory(req.params.id as string, getUser(req));
    res.json(history);
  }

  async getPayments(req: Request, res: Response): Promise<void> {
    const payments = await clientsService.getPayments(req.params.id as string, getUser(req));
    res.json(payments);
  }

  async getAnalytics(req: Request, res: Response): Promise<void> {
    const periodDays = req.query.periodDays ? parseInt(req.query.periodDays as string, 10) : 30;
    const analytics = await clientsService.getAnalytics(req.params.id as string, getUser(req), periodDays);
    res.json(analytics);
  }
}

export const clientsController = new ClientsController();
