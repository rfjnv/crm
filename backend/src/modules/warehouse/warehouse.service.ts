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

  async deleteProduct(id: string, userId: string) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    const usedInDeals = await prisma.dealItem.findFirst({ where: { productId: id } });
    if (usedInDeals) {
      throw new AppError(400, 'Невозможно удалить товар — он используется в сделках');
    }

    await prisma.inventoryMovement.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });

    await auditLog({
      userId,
      action: 'DELETE',
      entityType: 'product',
      entityId: id,
      before: { name: product.name, sku: product.sku },
    });

    return { success: true };
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

  async getProductAnalytics(productId: string, periodDays: number) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    const from = new Date();
    from.setDate(from.getDate() - periodDays);

    const [movements, dealItems, topClientsRaw] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where: { productId, createdAt: { gte: from } },
        select: { type: true, quantity: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.dealItem.findMany({
        where: { productId, deal: { createdAt: { gte: from }, status: { not: 'CANCELED' } } },
        select: { requestedQty: true, price: true, deal: { select: { id: true, clientId: true, status: true } } },
      }),
      prisma.$queryRaw<{ client_id: string; company_name: string; total_qty: number }[]>(
        Prisma.sql`
          SELECT c.id as client_id, c.company_name, COALESCE(SUM(di.requested_qty), 0)::int as total_qty
          FROM deal_items di
          JOIN deals d ON d.id = di.deal_id
          JOIN clients c ON c.id = d.client_id
          WHERE di.product_id = ${productId}
            AND d.created_at >= ${from}
            AND d.status != 'CANCELED'
            AND di.requested_qty > 0
          GROUP BY c.id, c.company_name
          ORDER BY total_qty DESC
          LIMIT 10
        `,
      ),
    ]);

    const totalIn = movements.filter((m) => m.type === 'IN').reduce((s, m) => s + Number(m.quantity), 0);
    const totalOut = movements.filter((m) => m.type === 'OUT').reduce((s, m) => s + Number(m.quantity), 0);

    // Movement trend by day
    const dayMap = new Map<string, { inQty: number; outQty: number }>();
    for (const m of movements) {
      const day = m.createdAt.toISOString().slice(0, 10);
      const entry = dayMap.get(day) || { inQty: 0, outQty: 0 };
      if (m.type === 'IN') entry.inQty += Number(m.quantity);
      else entry.outQty += Number(m.quantity);
      dayMap.set(day, entry);
    }
    const movementsByDay = Array.from(dayMap.entries())
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day));

    // Sales metrics
    const totalQuantitySold = dealItems.reduce((s, di) => s + Number(di.requestedQty || 0), 0);
    const totalRevenue = dealItems.reduce((s, di) => s + Number(di.requestedQty || 0) * Number(di.price || 0), 0);
    const uniqueDeals = new Set(dealItems.map((di) => di.deal.id));
    const avgPricePerUnit = totalQuantitySold > 0 ? totalRevenue / totalQuantitySold : 0;

    // Profitability
    const purchasePrice = Number(product.purchasePrice || 0);
    const totalCost = purchasePrice * totalQuantitySold;
    const grossProfit = totalRevenue - totalCost;
    const marginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return {
      product,
      movements: { totalIn, totalOut, movementsByDay },
      sales: {
        totalRevenue,
        totalQuantitySold,
        dealsUsing: uniqueDeals.size,
        avgPricePerUnit,
      },
      profitability: {
        totalCost,
        totalRevenue,
        grossProfit,
        marginPercent,
      },
      topClients: topClientsRaw.map((r) => ({
        clientId: r.client_id,
        companyName: r.company_name,
        totalQty: Number(r.total_qty),
      })),
    };
  }

}

export const warehouseService = new WarehouseService();
