import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { poaService } from './power-of-attorney.service';
import { AuthUser } from '../../lib/scope';

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

export class PowerOfAttorneyController {
  async findAll(req: Request, res: Response): Promise<void> {
    const contractId = req.query.contractId as string | undefined;
    const poas = await poaService.findAll(contractId);
    res.json(poas);
  }

  async findById(req: Request, res: Response): Promise<void> {
    const poa = await poaService.findById(req.params.id as string);
    res.json(poa);
  }

  async create(req: Request, res: Response): Promise<void> {
    const poa = await poaService.create(req.body, getUser(req));
    res.status(201).json(poa);
  }

  async update(req: Request, res: Response): Promise<void> {
    const poa = await poaService.update(req.params.id as string, req.body, getUser(req));
    res.json(poa);
  }

  async delete(req: Request, res: Response): Promise<void> {
    const result = await poaService.delete(req.params.id as string, getUser(req));
    res.json(result);
  }

  async print(req: Request, res: Response): Promise<void> {
    try {
      const pdfBuffer = await poaService.generatePdf(req.params.id as string);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="poa-${req.params.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error('PoA PDF generation error:', error instanceof Error ? error.stack : error);
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const status = (error as { statusCode?: number }).statusCode || 500;
      res.status(status).json({ error: `Ошибка генерации PDF: ${message}` });
    }
  }
}

export const poaController = new PowerOfAttorneyController();
