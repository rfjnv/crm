import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { CreateProductDto, UpdateProductDto, CreateMovementDto } from './warehouse.dto';

export class WarehouseService {
  // ==================== PRODUCTS ====================

  async findAllProducts() {
    return prisma.product.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createProduct(dto: CreateProductDto, userId: string) {
    const existing = await prisma.product.findUnique({ where: { sku: dto.sku } });
    if (existing) {
      throw new AppError(409, 'Товар с таким артикулом уже существует');
    }

    const { manufacturedAt, expiresAt, specifications, ...rest } = dto;
    const data: Prisma.ProductCreateInput = {
      ...rest,
      ...(specifications ? { specifications: specifications as Prisma.InputJsonValue } : {}),
      ...(manufacturedAt ? { manufacturedAt: new Date(manufacturedAt) } : {}),
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
    };

    const product = await prisma.product.create({ data });

    await auditLog({
      userId,
      action: 'CREATE',
      entityType: 'product',
      entityId: product.id,
      after: { name: product.name, sku: product.sku },
    });

    return product;
  }

  async updateProduct(id: string, dto: UpdateProductDto, userId: string) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    if (dto.sku && dto.sku !== product.sku) {
      const existing = await prisma.product.findUnique({ where: { sku: dto.sku } });
      if (existing) {
        throw new AppError(409, 'Товар с таким артикулом уже существует');
      }
    }

    const before = { name: product.name, sku: product.sku, unit: product.unit, isActive: product.isActive };

    const { manufacturedAt, expiresAt, specifications, ...rest } = dto;
    const data: Prisma.ProductUpdateInput = {
      ...rest,
      ...(specifications !== undefined
        ? { specifications: specifications === null ? Prisma.DbNull : specifications as Prisma.InputJsonValue }
        : {}),
      ...(manufacturedAt !== undefined ? { manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null } : {}),
      ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
    };

    const updated = await prisma.product.update({ where: { id }, data });

    await auditLog({
      userId,
      action: 'UPDATE',
      entityType: 'product',
      entityId: id,
      before,
      after: { name: updated.name, sku: updated.sku, unit: updated.unit, isActive: updated.isActive },
    });

    return updated;
  }

  // ==================== MOVEMENTS ====================

  async createMovement(dto: CreateMovementDto, userId: string) {
    const product = await prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || !product.isActive) {
      throw new AppError(404, 'Товар не найден или неактивен');
    }

    if (dto.dealId) {
      const deal = await prisma.deal.findUnique({ where: { id: dto.dealId } });
      if (!deal) {
        throw new AppError(404, 'Сделка не найдена');
      }
    }

    // Atomic stock update in transaction
    return prisma.$transaction(async (tx) => {
      if (dto.type === 'IN') {
        // Increment stock atomically
        await tx.product.update({
          where: { id: dto.productId },
          data: { stock: { increment: dto.quantity } },
        });
      } else {
        // Decrement stock with guard: only if stock >= quantity
        const result = await tx.product.updateMany({
          where: {
            id: dto.productId,
            stock: { gte: dto.quantity },
          },
          data: { stock: { decrement: dto.quantity } },
        });

        if (result.count === 0) {
          throw new AppError(400, `Недостаточно товара на складе. Текущий остаток: ${product.stock}`);
        }
      }

      // Create movement record
      const movement = await tx.inventoryMovement.create({
        data: {
          productId: dto.productId,
          type: dto.type,
          quantity: dto.quantity,
          dealId: dto.dealId,
          note: dto.note,
          createdBy: userId,
        },
        include: {
          product: { select: { id: true, name: true, sku: true, stock: true } },
          deal: { select: { id: true, title: true } },
        },
      });

      // Audit log
      await auditLog({
        userId,
        action: 'CREATE',
        entityType: 'inventory_movement',
        entityId: movement.id,
        after: {
          productId: dto.productId,
          productName: movement.product.name,
          type: dto.type,
          quantity: dto.quantity,
          newStock: movement.product.stock,
          dealId: dto.dealId,
        },
      });

      return movement;
    });
  }

  async getMovements(productId?: string) {
    return prisma.inventoryMovement.findMany({
      where: productId ? { productId } : {},
      include: {
        product: { select: { id: true, name: true, sku: true } },
        deal: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getProductMovements(productId: string) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    return prisma.inventoryMovement.findMany({
      where: { productId },
      include: {
        deal: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

}

export const warehouseService = new WarehouseService();
