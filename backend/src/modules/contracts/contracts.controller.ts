import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { contractsService } from './contracts.service';
import { AuthUser } from '../../lib/scope';

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

export class ContractsController {
  async findAll(req: Request, res: Response): Promise<void> {
    const clientId = req.query.clientId as string | undefined;
    const contracts = await contractsService.findAll(clientId);
    res.json(contracts);
  }

  async findById(req: Request, res: Response): Promise<void> {
    const contract = await contractsService.findById(req.params.id as string);
    res.json(contract);
  }

  async create(req: Request, res: Response): Promise<void> {
    const contract = await contractsService.create(req.body, getUser(req));
    res.status(201).json(contract);
  }

  async update(req: Request, res: Response): Promise<void> {
    const contract = await contractsService.update(req.params.id as string, req.body, getUser(req));
    res.json(contract);
  }
}

export const contractsController = new ContractsController();
