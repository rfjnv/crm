import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import {
  CreateSupplierSiteDto,
  CreateVedMapRouteDto,
  UpdateSupplierSiteDto,
  UpdateVedMapRouteDto,
} from './ved-map.dto';

const siteInclude = {
  supplier: {
    select: {
      id: true,
      companyName: true,
      country: true,
      logoPath: true,
      isArchived: true,
    },
  },
} as const;

const routeInclude = {
  supplier: {
    select: { id: true, companyName: true, logoPath: true },
  },
  createdBy: {
    select: { id: true, fullName: true },
  },
  points: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          siteType: true,
          supplierId: true,
        },
      },
    },
  },
} as const;

export class VedMapService {
  async listSites(params: { supplierId?: string; siteType?: string; includeArchivedSuppliers?: boolean }) {
    const where: Record<string, unknown> = {};
    if (params.supplierId) where.supplierId = params.supplierId;
    if (params.siteType) where.siteType = params.siteType;
    if (!params.includeArchivedSuppliers) {
      where.supplier = { isArchived: false };
    }

    return prisma.supplierSite.findMany({
      where,
      orderBy: [{ supplier: { companyName: 'asc' } }, { name: 'asc' }],
      include: siteInclude,
    });
  }

  async createSite(dto: CreateSupplierSiteDto) {
    const supplier = await prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier) throw new AppError(404, 'Поставщик не найден');

    return prisma.supplierSite.create({
      data: {
        supplierId: dto.supplierId,
        name: dto.name,
        siteType: dto.siteType ?? 'FACTORY',
        address: dto.address ?? null,
        country: dto.country ?? supplier.country ?? null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        notes: dto.notes ?? null,
      },
      include: siteInclude,
    });
  }

  async updateSite(id: string, dto: UpdateSupplierSiteDto) {
    const existing = await prisma.supplierSite.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Точка не найдена');

    if (dto.supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) throw new AppError(404, 'Поставщик не найден');
    }

    return prisma.supplierSite.update({
      where: { id },
      data: {
        ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.siteType !== undefined ? { siteType: dto.siteType } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.country !== undefined ? { country: dto.country } : {}),
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: siteInclude,
    });
  }

  async deleteSite(id: string) {
    const existing = await prisma.supplierSite.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Точка не найдена');
    await prisma.supplierSite.delete({ where: { id } });
  }

  async listRoutes(params: { supplierId?: string }) {
    const where: Record<string, unknown> = {};
    if (params.supplierId) where.supplierId = params.supplierId;

    return prisma.vedMapRoute.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: routeInclude,
    });
  }

  async createRoute(dto: CreateVedMapRouteDto, userId: string) {
    if (dto.supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) throw new AppError(404, 'Поставщик не найден');
    }

    return prisma.vedMapRoute.create({
      data: {
        name: dto.name,
        supplierId: dto.supplierId ?? null,
        color: dto.color ?? '#22609A',
        notes: dto.notes ?? null,
        createdById: userId,
        points: {
          create: dto.points.map((p, i) => ({
            siteId: p.siteId ?? null,
            label: p.label ?? null,
            latitude: p.latitude,
            longitude: p.longitude,
            sortOrder: i,
          })),
        },
      },
      include: routeInclude,
    });
  }

  async updateRoute(id: string, dto: UpdateVedMapRouteDto) {
    const existing = await prisma.vedMapRoute.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Маршрут не найден');

    if (dto.supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) throw new AppError(404, 'Поставщик не найден');
    }

    return prisma.$transaction(async (tx) => {
      if (dto.points) {
        await tx.vedMapRoutePoint.deleteMany({ where: { routeId: id } });
        await tx.vedMapRoutePoint.createMany({
          data: dto.points.map((p, i) => ({
            routeId: id,
            siteId: p.siteId ?? null,
            label: p.label ?? null,
            latitude: p.latitude,
            longitude: p.longitude,
            sortOrder: i,
          })),
        });
      }

      return tx.vedMapRoute.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
        include: routeInclude,
      });
    });
  }

  async deleteRoute(id: string) {
    const existing = await prisma.vedMapRoute.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Маршрут не найден');
    await prisma.vedMapRoute.delete({ where: { id } });
  }
}

export const vedMapService = new VedMapService();
