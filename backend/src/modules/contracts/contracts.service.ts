import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser } from '../../lib/scope';
import { CreateContractDto, UpdateContractDto } from './contracts.dto';
import path from 'path';
import fs from 'fs';

export class ContractsService {
  async findAll(clientId?: string) {
    const contracts = await prisma.contract.findMany({
      where: clientId ? { clientId } : {},
      include: {
        client: { select: { id: true, companyName: true } },
        deals: {
          select: { id: true, amount: true, paidAmount: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return contracts.map((c) => {
      const totalAmount = c.deals.reduce((s, d) => s + Number(d.amount), 0);
      const totalPaid = c.deals.reduce((s, d) => s + Number(d.paidAmount), 0);
      return {
        ...c,
        dealsCount: c.deals.length,
        totalAmount,
        totalPaid,
        remaining: totalAmount - totalPaid,
        deals: undefined,
      };
    });
  }

  async findById(id: string) {
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyName: true } },
        deals: {
          select: {
            id: true, title: true, status: true, amount: true,
            paidAmount: true, paymentStatus: true, paymentType: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        attachments: {
          include: { uploader: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!contract) {
      throw new AppError(404, 'Договор не найден');
    }

    const totalAmount = contract.deals.reduce((s, d) => s + Number(d.amount), 0);
    const totalPaid = contract.deals.reduce((s, d) => s + Number(d.paidAmount), 0);

    const dealIds = contract.deals.map((d) => d.id);
    const payments = dealIds.length > 0
      ? await prisma.payment.findMany({
          where: { dealId: { in: dealIds } },
          include: {
            deal: { select: { id: true, title: true } },
            creator: { select: { id: true, fullName: true } },
          },
          orderBy: { paidAt: 'desc' },
        })
      : [];

    return {
      ...contract,
      totalAmount,
      totalPaid,
      remaining: totalAmount - totalPaid,
      payments: payments.map((p) => ({
        id: p.id,
        dealId: p.dealId,
        amount: Number(p.amount),
        paidAt: p.paidAt,
        method: p.method,
        note: p.note,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        deal: p.deal,
        creator: p.creator,
      })),
    };
  }

  async create(dto: CreateContractDto, user: AuthUser) {
    const client = await prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    const existing = await prisma.contract.findUnique({
      where: { contractNumber: dto.contractNumber },
    });
    if (existing) {
      throw new AppError(409, 'Договор с таким номером уже существует');
    }

    const contract = await prisma.contract.create({
      data: {
        clientId: dto.clientId,
        contractNumber: dto.contractNumber,
        amount: dto.amount ?? 0,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        notes: dto.notes,
      },
      include: {
        client: { select: { id: true, companyName: true } },
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'contract',
      entityId: contract.id,
      after: { contractNumber: contract.contractNumber, clientId: contract.clientId },
    });

    return contract;
  }

  async update(id: string, dto: UpdateContractDto, user: AuthUser) {
    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract) {
      throw new AppError(404, 'Договор не найден');
    }

    if (dto.contractNumber && dto.contractNumber !== contract.contractNumber) {
      const existing = await prisma.contract.findUnique({
        where: { contractNumber: dto.contractNumber },
      });
      if (existing) {
        throw new AppError(409, 'Договор с таким номером уже существует');
      }
    }

    const before = {
      contractNumber: contract.contractNumber,
      amount: contract.amount,
      startDate: contract.startDate,
      endDate: contract.endDate,
      isActive: contract.isActive,
      notes: contract.notes,
    };

    const data: Record<string, unknown> = {};
    if (dto.contractNumber !== undefined) data.contractNumber = dto.contractNumber;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const updated = await prisma.contract.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, companyName: true } },
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'contract',
      entityId: id,
      before,
      after: {
        contractNumber: updated.contractNumber,
        amount: updated.amount,
        startDate: updated.startDate,
        endDate: updated.endDate,
        isActive: updated.isActive,
        notes: updated.notes,
      },
    });

    return updated;
  }

  // ==================== ATTACHMENTS ====================

  async uploadAttachment(contractId: string, file: Express.Multer.File, user: AuthUser) {
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) {
      throw new AppError(404, 'Договор не найден');
    }

    const uploadsDir = path.join(process.cwd(), 'uploads', 'contracts');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const ext = path.extname(file.originalname);
    const safeFilename = `${contractId}_${Date.now()}${ext}`;
    const filePath = path.join(uploadsDir, safeFilename);

    fs.writeFileSync(filePath, file.buffer);

    const attachment = await prisma.contractAttachment.create({
      data: {
        contractId,
        filename: file.originalname,
        path: `uploads/contracts/${safeFilename}`,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: user.userId,
      },
      include: { uploader: { select: { id: true, fullName: true } } },
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'contract_attachment',
      entityId: attachment.id,
      after: { contractId, filename: file.originalname, size: file.size },
    });

    return attachment;
  }

  async deleteAttachment(attachmentId: string, user: AuthUser) {
    const attachment = await prisma.contractAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) {
      throw new AppError(404, 'Вложение не найдено');
    }

    // Delete physical file if exists
    const fullPath = path.join(process.cwd(), attachment.path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    await prisma.contractAttachment.delete({ where: { id: attachmentId } });

    await auditLog({
      userId: user.userId,
      action: 'DELETE',
      entityType: 'contract_attachment',
      entityId: attachmentId,
      before: { contractId: attachment.contractId, filename: attachment.filename },
    });

    return { success: true };
  }
}

export const contractsService = new ContractsService();
