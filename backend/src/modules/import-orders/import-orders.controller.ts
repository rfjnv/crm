import { Request, Response } from 'express';
import { ImportDocumentType, ImportOrderStatus, Role } from '@prisma/client';
import { importOrdersService } from './import-orders.service';
import { AuthUser } from '../../lib/scope';

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

export class ImportOrdersController {
  async findAll(req: Request, res: Response): Promise<void> {
    const status = req.query.status as string | undefined;
    const supplierId = req.query.supplierId as string | undefined;
    const search = (req.query.search as string | undefined)?.trim() || undefined;
    const orders = await importOrdersService.findAll({ status, supplierId, search });
    res.json(orders);
  }

  async findById(req: Request, res: Response): Promise<void> {
    const order = await importOrdersService.findById(req.params.id as string);
    res.json(order);
  }

  async landedCost(req: Request, res: Response): Promise<void> {
    const data = await importOrdersService.getLandedCost(req.params.id as string);
    res.json(data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const order = await importOrdersService.create(req.body, getUser(req));
    res.status(201).json(order);
  }

  async update(req: Request, res: Response): Promise<void> {
    const order = await importOrdersService.update(req.params.id as string, req.body, getUser(req));
    res.json(order);
  }

  async replaceItems(req: Request, res: Response): Promise<void> {
    const order = await importOrdersService.replaceItems(req.params.id as string, req.body, getUser(req));
    res.json(order);
  }

  async changeStatus(req: Request, res: Response): Promise<void> {
    const status = req.body.status as ImportOrderStatus;
    const order = await importOrdersService.changeStatus(req.params.id as string, status, getUser(req));
    res.json(order);
  }

  async uploadAttachment(req: Request, res: Response): Promise<void> {
    if (!req.file) {
      res.status(400).json({ error: 'Файл не предоставлен' });
      return;
    }
    const rawType = ((req.body?.documentType as string | undefined) || 'OTHER').toUpperCase();
    const allowed: ImportDocumentType[] = [
      'INVOICE', 'PACKING_LIST', 'BILL_OF_LADING', 'CMR',
      'CERT_OF_ORIGIN', 'CUSTOMS_DECLARATION', 'SWIFT', 'OTHER',
    ];
    const documentType: ImportDocumentType = (allowed as string[]).includes(rawType)
      ? (rawType as ImportDocumentType)
      : 'OTHER';

    const attachment = await importOrdersService.uploadAttachment(
      req.params.id as string,
      documentType,
      req.file,
      getUser(req),
    );
    res.status(201).json(attachment);
  }

  async deleteAttachment(req: Request, res: Response): Promise<void> {
    const result = await importOrdersService.deleteAttachment(
      req.params.attachmentId as string,
      getUser(req),
    );
    res.json(result);
  }
}

export const importOrdersController = new ImportOrdersController();
