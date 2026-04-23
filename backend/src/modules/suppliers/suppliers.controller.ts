import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { suppliersService } from './suppliers.service';
import { AuthUser } from '../../lib/scope';

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

export class SuppliersController {
  async findAll(req: Request, res: Response): Promise<void> {
    const includeArchived = req.query.includeArchived === 'true';
    const search = (req.query.search as string | undefined)?.trim() || undefined;
    const suppliers = await suppliersService.findAll({ includeArchived, search });
    res.json(suppliers);
  }

  async findById(req: Request, res: Response): Promise<void> {
    const supplier = await suppliersService.findById(req.params.id as string);
    res.json(supplier);
  }

  async create(req: Request, res: Response): Promise<void> {
    const supplier = await suppliersService.create(req.body, getUser(req));
    res.status(201).json(supplier);
  }

  async update(req: Request, res: Response): Promise<void> {
    const supplier = await suppliersService.update(req.params.id as string, req.body, getUser(req));
    res.json(supplier);
  }

  async archive(req: Request, res: Response): Promise<void> {
    const result = await suppliersService.archive(req.params.id as string, getUser(req));
    res.json(result);
  }
}

export const suppliersController = new SuppliersController();
