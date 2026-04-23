import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser } from '../../lib/scope';
import { CreateSupplierDto, UpdateSupplierDto } from './suppliers.dto';

export class SuppliersService {
  async findAll(params: { includeArchived?: boolean; search?: string }) {
    const where: Record<string, unknown> = {};
    if (!params.includeArchived) where.isArchived = false;
    if (params.search) {
      where.OR = [
        { companyName: { contains: params.search, mode: 'insensitive' } },
        { country: { contains: params.search, mode: 'insensitive' } },
        { contactPerson: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { importOrders: true, products: true },
        },
      },
    });

    return suppliers.map((s) => ({
      ...s,
      ordersCount: s._count.importOrders,
      productsCount: s._count.products,
      _count: undefined,
    }));
  }

  async findById(id: string) {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        products: {
          select: {
            id: true, name: true, sku: true, unit: true,
            countryOfOrigin: true, stock: true, isActive: true,
          },
          orderBy: { name: 'asc' },
        },
        importOrders: {
          select: {
            id: true, number: true, status: true, orderDate: true,
            etd: true, eta: true, currency: true, totalAmount: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!supplier) {
      throw new AppError(404, 'Поставщик не найден');
    }
    return supplier;
  }

  async create(dto: CreateSupplierDto, user: AuthUser) {
    const supplier = await prisma.supplier.create({
      data: {
        companyName: dto.companyName,
        country: dto.country ?? null,
        contactPerson: dto.contactPerson ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        currency: dto.currency ?? 'USD',
        incoterms: dto.incoterms ?? null,
        paymentTerms: dto.paymentTerms ?? null,
        bankSwift: dto.bankSwift ?? null,
        iban: dto.iban ?? null,
        notes: dto.notes ?? null,
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'supplier',
      entityId: supplier.id,
      after: { companyName: supplier.companyName, country: supplier.country, currency: supplier.currency },
    });

    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto, user: AuthUser) {
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'Поставщик не найден');
    }

    const before = {
      companyName: existing.companyName,
      country: existing.country,
      currency: existing.currency,
      isArchived: existing.isArchived,
    };

    const data: Record<string, unknown> = {};
    for (const key of Object.keys(dto) as (keyof UpdateSupplierDto)[]) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }

    const updated = await prisma.supplier.update({ where: { id }, data });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'supplier',
      entityId: id,
      before,
      after: {
        companyName: updated.companyName,
        country: updated.country,
        currency: updated.currency,
        isArchived: updated.isArchived,
      },
    });

    return updated;
  }

  async archive(id: string, user: AuthUser) {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new AppError(404, 'Поставщик не найден');
    }
    const updated = await prisma.supplier.update({
      where: { id },
      data: { isArchived: !supplier.isArchived },
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'supplier',
      entityId: id,
      before: { isArchived: supplier.isArchived },
      after: { isArchived: updated.isArchived },
      reason: updated.isArchived ? 'archive' : 'restore',
    });
    return updated;
  }
}

export const suppliersService = new SuppliersService();
