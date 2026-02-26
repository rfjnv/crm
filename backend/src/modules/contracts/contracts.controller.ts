import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { contractsService } from './contracts.service';
import { AuthUser } from '../../lib/scope';
import type { DocType } from '../../lib/pdf-generator';

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

  async uploadAttachment(req: Request, res: Response): Promise<void> {
    if (!req.file) {
      res.status(400).json({ error: 'Файл не предоставлен' });
      return;
    }
    const attachment = await contractsService.uploadAttachment(
      req.params.id as string,
      req.file,
      getUser(req),
    );
    res.status(201).json(attachment);
  }

  async deleteAttachment(req: Request, res: Response): Promise<void> {
    const result = await contractsService.deleteAttachment(req.params.attachmentId as string, getUser(req));
    res.json(result);
  }

  async softDelete(req: Request, res: Response): Promise<void> {
    const result = await contractsService.softDelete(req.params.id as string, req.body, getUser(req));
    res.json(result);
  }

  async hardDelete(req: Request, res: Response): Promise<void> {
    const result = await contractsService.hardDelete(req.params.id as string, getUser(req));
    res.json(result);
  }

  async printContract(req: Request, res: Response): Promise<void> {
    try {
      const validDocTypes = ['CONTRACT', 'SPECIFICATION', 'INVOICE', 'POWER_OF_ATTORNEY', 'PACKAGE'];
      const docParam = (req.query.doc as string || 'CONTRACT').toUpperCase();
      const docType: DocType = validDocTypes.includes(docParam) ? docParam as DocType : 'CONTRACT';

      const pdfBuffer = await contractsService.generatePdf(req.params.id as string, docType);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="contract-${req.params.id}-${docType.toLowerCase()}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error('PDF generation error:', error instanceof Error ? error.stack : error);
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const status = (error as { statusCode?: number }).statusCode || 500;
      res.status(status).json({ error: `Ошибка генерации PDF: ${message}` });
    }
  }
}

export const contractsController = new ContractsController();
