import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser } from '../../lib/scope';
import { CreateContractDto, UpdateContractDto } from './contracts.dto';

export class ContractsService {
  async findAll(clientId?: string) {
    return prisma.contract.findMany({
      where: clientId ? { clientId } : {},
      include: {
        client: { select: { id: true, companyName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyName: true } },
        deals: {
          where: { isArchived: false },
          select: { id: true, title: true, status: true, amount: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!contract) {
      throw new AppError(404, 'Договор не найден');
    }

    return contract;
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
      startDate: contract.startDate,
      endDate: contract.endDate,
      isActive: contract.isActive,
      notes: contract.notes,
    };

    const data: Record<string, unknown> = {};
    if (dto.contractNumber !== undefined) data.contractNumber = dto.contractNumber;
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
        startDate: updated.startDate,
        endDate: updated.endDate,
        isActive: updated.isActive,
        notes: updated.notes,
      },
    });

    return updated;
  }
}

export const contractsService = new ContractsService();
