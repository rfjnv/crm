import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser } from '../../lib/scope';
import { CreatePoaDto, UpdatePoaDto } from './power-of-attorney.dto';
import { buildPowerOfAttorneyHtml, generateDocumentPdf } from '../../lib/pdf-generator';
import type { PowerOfAttorneyForPdf } from '../../lib/pdf-generator';

export class PowerOfAttorneyService {
  async findAll(contractId?: string) {
    const where: Record<string, unknown> = {};
    if (contractId) where.contractId = contractId;

    return prisma.powerOfAttorney.findMany({
      where,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            client: { select: { id: true, companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const poa = await prisma.powerOfAttorney.findUnique({
      where: { id },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            startDate: true,
            client: {
              select: {
                id: true, companyName: true, contactName: true,
                phone: true, address: true,
                inn: true, bankName: true, bankAccount: true,
                mfo: true, vatRegCode: true, oked: true,
              },
            },
          },
        },
      },
    });

    if (!poa) {
      throw new AppError(404, 'Доверенность не найдена');
    }

    return poa;
  }

  async create(dto: CreatePoaDto, user: AuthUser) {
    const contract = await prisma.contract.findUnique({ where: { id: dto.contractId } });
    if (!contract) {
      throw new AppError(404, 'Договор не найден');
    }

    const existing = await prisma.powerOfAttorney.findUnique({
      where: { poaNumber: dto.poaNumber },
    });
    if (existing) {
      throw new AppError(409, 'Доверенность с таким номером уже существует');
    }

    const poa = await prisma.powerOfAttorney.create({
      data: {
        contractId: dto.contractId,
        poaNumber: dto.poaNumber,
        poaType: dto.poaType,
        authorizedPersonName: dto.authorizedPersonName,
        authorizedPersonInn: dto.authorizedPersonInn,
        authorizedPersonPosition: dto.authorizedPersonPosition,
        validFrom: new Date(dto.validFrom),
        validUntil: new Date(dto.validUntil),
        items: dto.items ?? undefined,
        notes: dto.notes,
      },
      include: {
        contract: {
          select: { id: true, contractNumber: true },
        },
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'power_of_attorney',
      entityId: poa.id,
      after: { poaNumber: poa.poaNumber, contractId: poa.contractId },
    });

    return poa;
  }

  async update(id: string, dto: UpdatePoaDto, user: AuthUser) {
    const poa = await prisma.powerOfAttorney.findUnique({ where: { id } });
    if (!poa) {
      throw new AppError(404, 'Доверенность не найдена');
    }

    if (dto.poaNumber && dto.poaNumber !== poa.poaNumber) {
      const existing = await prisma.powerOfAttorney.findUnique({
        where: { poaNumber: dto.poaNumber },
      });
      if (existing) {
        throw new AppError(409, 'Доверенность с таким номером уже существует');
      }
    }

    const before = {
      poaNumber: poa.poaNumber,
      authorizedPersonName: poa.authorizedPersonName,
      validFrom: poa.validFrom,
      validUntil: poa.validUntil,
    };

    const data: Record<string, unknown> = {};
    if (dto.poaNumber !== undefined) data.poaNumber = dto.poaNumber;
    if (dto.poaType !== undefined) data.poaType = dto.poaType;
    if (dto.authorizedPersonName !== undefined) data.authorizedPersonName = dto.authorizedPersonName;
    if (dto.authorizedPersonInn !== undefined) data.authorizedPersonInn = dto.authorizedPersonInn;
    if (dto.authorizedPersonPosition !== undefined) data.authorizedPersonPosition = dto.authorizedPersonPosition;
    if (dto.validFrom !== undefined) data.validFrom = new Date(dto.validFrom);
    if (dto.validUntil !== undefined) data.validUntil = new Date(dto.validUntil);
    if (dto.items !== undefined) data.items = dto.items;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const updated = await prisma.powerOfAttorney.update({
      where: { id },
      data,
      include: {
        contract: { select: { id: true, contractNumber: true } },
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'power_of_attorney',
      entityId: id,
      before,
      after: {
        poaNumber: updated.poaNumber,
        authorizedPersonName: updated.authorizedPersonName,
        validFrom: updated.validFrom,
        validUntil: updated.validUntil,
      },
    });

    return updated;
  }

  async delete(id: string, user: AuthUser) {
    const poa = await prisma.powerOfAttorney.findUnique({ where: { id } });
    if (!poa) {
      throw new AppError(404, 'Доверенность не найдена');
    }

    await auditLog({
      userId: user.userId,
      action: 'DELETE',
      entityType: 'power_of_attorney',
      entityId: id,
      before: { poaNumber: poa.poaNumber, contractId: poa.contractId },
    });

    await prisma.powerOfAttorney.delete({ where: { id } });

    return { success: true };
  }

  async generatePdf(id: string): Promise<Buffer> {
    const poa = await this.findById(id);

    const companySettings = await prisma.companySettings.findUnique({
      where: { id: 'singleton' },
    });

    const poaForPdf: PowerOfAttorneyForPdf = {
      poaNumber: poa.poaNumber,
      poaType: poa.poaType,
      authorizedPersonName: poa.authorizedPersonName,
      authorizedPersonInn: poa.authorizedPersonInn,
      authorizedPersonPosition: poa.authorizedPersonPosition,
      validFrom: poa.validFrom,
      validUntil: poa.validUntil,
      items: (poa.items as { name: string; unit: string; qty?: number }[]) || [],
      contract: {
        contractNumber: poa.contract.contractNumber,
        startDate: poa.contract.startDate,
      },
      client: poa.contract.client,
    };

    const html = buildPowerOfAttorneyHtml(poaForPdf, companySettings);
    return generateDocumentPdf([html]);
  }
}

export const poaService = new PowerOfAttorneyService();
