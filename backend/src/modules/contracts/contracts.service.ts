import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser } from '../../lib/scope';
import { CreateContractDto, UpdateContractDto, DeleteContractDto } from './contracts.dto';
import { validateUploadedFile, generateStorageName, sanitizeFilename } from '../../lib/uploadSecurity';
import { generateContractPdf, buildContractHtml, buildSpecificationHtml, buildInvoiceHtml, buildPowerOfAttorneyHtml, generateDocumentPdf } from '../../lib/pdf-generator';
import type { DocType, DealItemForPdf } from '../../lib/pdf-generator';
import path from 'path';
import fs from 'fs';

export class ContractsService {
  async findAll(clientId?: string) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (clientId) where.clientId = clientId;

    const contracts = await prisma.contract.findMany({
      where,
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
    const contract = await prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, phone: true, address: true } },
        deals: {
          select: {
            id: true, title: true, status: true, amount: true,
            paidAmount: true, paymentStatus: true, paymentType: true, createdAt: true,
            items: {
              select: {
                id: true,
                requestedQty: true,
                price: true,
                product: { select: { id: true, name: true, sku: true, unit: true } },
              },
            },
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
        contractType: dto.contractType ?? 'ONE_TIME',
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
    if (dto.contractType !== undefined) data.contractType = dto.contractType;
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

    // Validate magic bytes match declared MIME type
    validateUploadedFile(file.buffer, file.mimetype, file.originalname);

    const uploadsDir = path.join(process.cwd(), 'uploads', 'contracts');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Store on disk under UUID name, keep original name in DB
    const storageName = generateStorageName(file.originalname);
    const filePath = path.join(uploadsDir, storageName);

    fs.writeFileSync(filePath, file.buffer);

    const attachment = await prisma.contractAttachment.create({
      data: {
        contractId,
        filename: sanitizeFilename(file.originalname),
        path: `uploads/contracts/${storageName}`,
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
      after: { contractId, filename: sanitizeFilename(file.originalname), size: file.size },
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

  // ==================== DELETION ====================

  async softDelete(id: string, dto: DeleteContractDto, user: AuthUser) {
    const contract = await prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: { deals: { select: { id: true } } },
    });
    if (!contract) {
      throw new AppError(404, 'Договор не найден');
    }

    const before = {
      contractNumber: contract.contractNumber,
      clientId: contract.clientId,
      amount: contract.amount,
      isActive: contract.isActive,
    };

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedById: user.userId,
        deleteReason: dto.reason,
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'DELETE',
      entityType: 'contract',
      entityId: id,
      before,
      after: { deletedAt: updated.deletedAt, deleteReason: dto.reason },
      reason: dto.reason,
    });

    return { success: true };
  }

  async hardDelete(id: string, user: AuthUser) {
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        deals: { select: { id: true } },
        attachments: { select: { id: true, path: true } },
      },
    });
    if (!contract) {
      throw new AppError(404, 'Договор не найден');
    }

    if (contract.deals.length > 0) {
      throw new AppError(400, `Невозможно удалить договор: привязано ${contract.deals.length} сделок`);
    }

    // Delete physical attachment files
    for (const att of contract.attachments) {
      const fullPath = path.join(process.cwd(), att.path);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await auditLog({
      userId: user.userId,
      action: 'DELETE',
      entityType: 'contract',
      entityId: id,
      before: {
        contractNumber: contract.contractNumber,
        clientId: contract.clientId,
        amount: contract.amount,
        hardDelete: true,
      },
    });

    // Cascade deletes attachments due to onDelete: Cascade
    await prisma.contract.delete({ where: { id } });

    return { success: true };
  }

  // ==================== PDF GENERATION ====================

  async generatePdf(id: string, docType: DocType = 'CONTRACT'): Promise<Buffer> {
    const contract = await prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, phone: true, address: true } },
        deals: {
          select: {
            id: true, title: true, status: true, amount: true,
            paidAmount: true, paymentStatus: true, createdAt: true,
            items: {
              select: {
                requestedQty: true,
                price: true,
                product: { select: { name: true, sku: true, unit: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!contract) {
      throw new AppError(404, 'Договор не найден');
    }

    const companySettings = await prisma.companySettings.findUnique({
      where: { id: 'singleton' },
    });

    const totalAmount = contract.deals.reduce((s, d) => s + Number(d.amount), 0);
    const totalPaid = contract.deals.reduce((s, d) => s + Number(d.paidAmount), 0);

    const pdfContract = {
      ...contract,
      contractType: contract.contractType,
      totalAmount,
      totalPaid,
      remaining: totalAmount - totalPaid,
    };

    // Collect all deal items across all deals
    const allItems: DealItemForPdf[] = contract.deals.flatMap((d) =>
      d.items.map((item) => ({
        product: item.product,
        requestedQty: item.requestedQty,
        price: item.price,
      })),
    );

    const isAnnual = contract.contractType === 'ANNUAL';

    // Build HTML pages based on docType
    const htmlPages: string[] = [];

    switch (docType) {
      case 'CONTRACT':
        htmlPages.push(buildContractHtml(pdfContract, companySettings));
        break;
      case 'SPECIFICATION':
        htmlPages.push(buildSpecificationHtml(pdfContract, companySettings, allItems));
        break;
      case 'INVOICE':
        htmlPages.push(buildInvoiceHtml(pdfContract, companySettings, allItems));
        break;
      case 'POWER_OF_ATTORNEY':
        htmlPages.push(buildPowerOfAttorneyHtml(pdfContract, companySettings));
        break;
      case 'PACKAGE':
        if (isAnnual) {
          htmlPages.push(buildContractHtml(pdfContract, companySettings));
          htmlPages.push(buildSpecificationHtml(pdfContract, companySettings, allItems));
        }
        htmlPages.push(buildInvoiceHtml(pdfContract, companySettings, allItems));
        htmlPages.push(buildPowerOfAttorneyHtml(pdfContract, companySettings));
        break;
      default:
        htmlPages.push(buildContractHtml(pdfContract, companySettings));
    }

    return generateDocumentPdf(htmlPages);
  }
}

export const contractsService = new ContractsService();
