import prisma from '../../lib/prisma';
import { Prisma, Role } from '@prisma/client';
import { AppError } from '../../lib/errors';
import {
  resolveProductChartGranularity,
  sqlInventoryMovementBucket,
  sqlInventoryMovementBusinessDate,
  sqlMovementIncludedInProductAnalytics,
  sqlMovementIsAnalyticsCorrection,
} from '../../lib/inventoryAnalytics';
import { auditLog } from '../../lib/logger';
import { CreateProductDto, UpdateProductDto, CreateMovementDto, CorrectStockDto, CreateReservationDto, ImportExcelResult, ImportedProduct } from './warehouse.dto';

export class WarehouseService {
  // ==================== PRODUCTS ====================

  async findAllProducts(role?: Role, companyId?: string) {
    const where = (role !== 'SUPER_ADMIN' && companyId) ? { companyId } : {};
    const products = await prisma.product.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { posterPhotos: { orderBy: { sortOrder: 'asc' } } },
    });

    const reservedMap = await this.getReservedQtyMap(products.map((p) => p.id));
    return products.map((p) => this.withAvailability(p, reservedMap.get(p.id) ?? 0));
  }

  async findProductById(id: string) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { posterPhotos: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!product) throw new AppError(404, 'Товар не найден');
    const reservedMap = await this.getReservedQtyMap([id]);
    return this.withAvailability(product, reservedMap.get(id) ?? 0);
  }

  async addProductPhotos(productId: string, urls: string[]) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError(404, 'Товар не найден');

    const last = await prisma.productPosterPhoto.findFirst({
      where: { productId },
      orderBy: { sortOrder: 'desc' },
    });
    let sortOrder = (last?.sortOrder ?? -1) + 1;

    await prisma.productPosterPhoto.createMany({
      data: urls.map((url) => ({ productId, url, sortOrder: sortOrder++ })),
    });

    return prisma.productPosterPhoto.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } });
  }

  async deleteProductPhoto(productId: string, photoId: string) {
    const photo = await prisma.productPosterPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.productId !== productId) throw new AppError(404, 'Фото не найдено');
    await prisma.productPosterPhoto.delete({ where: { id: photoId } });
  }

  async createProduct(dto: CreateProductDto, userId: string, companyId?: string, role?: Role) {
    const existing = await prisma.product.findUnique({ where: { sku: dto.sku } });
    if (existing) {
      throw new AppError(409, 'Товар с таким артикулом уже существует');
    }

    let resolvedCompanyId = companyId;
    if (role === 'SUPER_ADMIN') {
      if (!dto.companyId) {
        throw new AppError(400, 'Выберите компанию для товара');
      }
      const company = await prisma.company.findUnique({ where: { id: dto.companyId } });
      if (!company) {
        throw new AppError(404, 'Компания не найдена');
      }
      resolvedCompanyId = dto.companyId;
    }

    const { manufacturedAt, expiresAt, specifications, companyId: _ignoreCompanyId, ...rest } = dto;
    const data: Prisma.ProductCreateInput = {
      ...rest,
      ...(resolvedCompanyId ? { companyId: resolvedCompanyId } : {}),
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

    const { manufacturedAt, expiresAt, badgeUntil, specifications, ...rest } = dto;
    const data: Prisma.ProductUpdateInput = {
      ...rest,
      ...(specifications !== undefined
        ? { specifications: specifications === null ? Prisma.DbNull : specifications as Prisma.InputJsonValue }
        : {}),
      ...(manufacturedAt !== undefined ? { manufacturedAt: manufacturedAt ? new Date(manufacturedAt) : null } : {}),
      ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
      ...(badgeUntil !== undefined ? { badgeUntil: badgeUntil ? new Date(badgeUntil) : null } : {}),
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

  async correctStock(id: string, dto: CorrectStockDto, userId: string) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    const oldStock = Number(product.stock);
    const diff = dto.newStock - oldStock;
    const oldRollStock = product.rollStock != null ? Number(product.rollStock) : null;
    const applyRollStock = dto.newRollStock !== undefined && oldRollStock !== null;

    // Transactional: update stock (+ rollStock, if tracked) + create CORRECTION movement
    const updated = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id },
        data: {
          stock: dto.newStock,
          ...(applyRollStock ? { rollStock: dto.newRollStock } : {}),
        },
      });

      // Create CORRECTION movement for history
      await tx.inventoryMovement.create({
        data: {
          productId: id,
          type: 'CORRECTION',
          quantity: Math.abs(diff),
          note: applyRollStock
            ? `Коррекция: ${dto.reason} (было ${oldStock} кг / ${oldRollStock} рул., стало ${dto.newStock} кг / ${dto.newRollStock} рул.)`
            : `Коррекция: ${dto.reason} (было ${oldStock}, стало ${dto.newStock})`,
          createdBy: userId,
        },
      });

      return updatedProduct;
    });

    await auditLog({
      userId,
      action: 'UPDATE',
      entityType: 'stock_correction',
      entityId: id,
      before: { stock: oldStock, rollStock: oldRollStock, name: product.name, sku: product.sku },
      after: { stock: dto.newStock, rollStock: applyRollStock ? dto.newRollStock : oldRollStock, reason: dto.reason },
      reason: dto.reason,
    });

    return updated;
  }

  /** Активные (непросроченные) брони по товарам: productId -> сумма количества. */
  private async getReservedQtyMap(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    await this.expireStaleReservations();
    const rows = await prisma.productReservation.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.productId, Number(r._sum.quantity ?? 0)]));
  }

  private withAvailability<T extends { stock: Prisma.Decimal }>(product: T, reservedQty: number) {
    const stock = Number(product.stock);
    return {
      ...product,
      reservedQty,
      availableStock: Math.max(0, stock - reservedQty),
    };
  }

  /** Переводит просроченные активные брони в EXPIRED (ленивая проверка при каждом обращении к броням). */
  private async expireStaleReservations(productId?: string) {
    await prisma.productReservation.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
        ...(productId ? { productId } : {}),
      },
      data: { status: 'EXPIRED' },
    });
  }

  // ==================== RESERVATIONS ====================

  async createReservation(dto: CreateReservationDto, userId: string) {
    const product = await prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || !product.isActive) {
      throw new AppError(404, 'Товар не найден или неактивен');
    }

    const client = await prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      throw new AppError(400, 'Срок брони должен быть в будущем');
    }

    await this.expireStaleReservations(dto.productId);

    const reservedRow = await prisma.productReservation.aggregate({
      where: { productId: dto.productId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    const reservedQty = Number(reservedRow._sum.quantity ?? 0);
    const availableStock = Number(product.stock) - reservedQty;

    if (dto.quantity > availableStock) {
      throw new AppError(400, `Недостаточно свободного остатка для брони. Доступно: ${availableStock}`);
    }

    const reservation = await prisma.productReservation.create({
      data: {
        productId: dto.productId,
        clientId: dto.clientId,
        managerId: userId,
        quantity: dto.quantity,
        expiresAt,
        note: dto.note,
      },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
      },
    });

    await auditLog({
      userId,
      action: 'CREATE',
      entityType: 'product_reservation',
      entityId: reservation.id,
      after: {
        productId: dto.productId,
        productName: product.name,
        clientId: dto.clientId,
        clientName: client.companyName,
        quantity: dto.quantity,
        expiresAt: dto.expiresAt,
      },
    });

    return reservation;
  }

  async listReservations(filters?: { productId?: string; clientId?: string; status?: 'ACTIVE' | 'CANCELLED' | 'FULFILLED' | 'EXPIRED' }) {
    await this.expireStaleReservations(filters?.productId);

    const where: Prisma.ProductReservationWhereInput = {};
    if (filters?.productId) where.productId = filters.productId;
    if (filters?.clientId) where.clientId = filters.clientId;
    if (filters?.status) where.status = filters.status;

    return prisma.productReservation.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProductReservations(productId: string) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError(404, 'Товар не найден');
    return this.listReservations({ productId });
  }

  async cancelReservation(id: string, userId: string) {
    const reservation = await prisma.productReservation.findUnique({ where: { id } });
    if (!reservation) throw new AppError(404, 'Бронь не найдена');
    if (reservation.status !== 'ACTIVE') {
      throw new AppError(400, 'Можно отменить только активную бронь');
    }

    const updated = await prisma.productReservation.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
      },
    });

    await auditLog({
      userId,
      action: 'UPDATE',
      entityType: 'product_reservation',
      entityId: id,
      before: { status: reservation.status },
      after: { status: 'CANCELLED' },
    });

    return updated;
  }

  async fulfillReservation(id: string, userId: string) {
    const reservation = await prisma.productReservation.findUnique({ where: { id } });
    if (!reservation) throw new AppError(404, 'Бронь не найдена');
    if (reservation.status !== 'ACTIVE') {
      throw new AppError(400, 'Можно закрыть только активную бронь');
    }

    const updated = await prisma.productReservation.update({
      where: { id },
      data: { status: 'FULFILLED', fulfilledAt: new Date() },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
      },
    });

    await auditLog({
      userId,
      action: 'UPDATE',
      entityType: 'product_reservation',
      entityId: id,
      before: { status: reservation.status },
      after: { status: 'FULFILLED' },
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
      if (dto.affectStock === false) {
        // Только запись в историю (напр. задним числом задокументировать приход,
        // который уже учтён в текущем остатке) — сам остаток не трогаем.
      } else if (dto.type === 'IN') {
        // Increment stock (+ rollStock, for products tracked in parallel rolls) atomically
        await tx.product.update({
          where: { id: dto.productId },
          data: {
            stock: { increment: dto.quantity },
            ...(dto.rollQuantity != null && product.rollStock != null
              ? { rollStock: { increment: dto.rollQuantity } }
              : {}),
          },
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

      const rollNoteApplied = dto.affectStock !== false && dto.type === 'IN' && dto.rollQuantity != null && product.rollStock != null;

      // Create movement record
      const movement = await tx.inventoryMovement.create({
        data: {
          productId: dto.productId,
          type: dto.type,
          quantity: dto.quantity,
          dealId: dto.dealId,
          note: [
            dto.note,
            dto.affectStock === false ? '(запись без изменения остатка)' : null,
            rollNoteApplied ? `(+${dto.rollQuantity} рул.)` : null,
          ].filter(Boolean).join(' ') || undefined,
          createdBy: userId,
        },
        include: {
          product: { select: { id: true, name: true, sku: true, stock: true } },
          deal: { select: { id: true, title: true, isReceiptPunched: true, client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } } } },
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

  async getMovements(filters?: {
    productId?: string;
    type?: 'IN' | 'OUT' | 'CORRECTION';
    createdBy?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }) {
    const where: Prisma.InventoryMovementWhereInput = {};
    if (filters?.productId) where.productId = filters.productId;
    if (filters?.type) where.type = filters.type;
    if (filters?.createdBy) where.createdBy = filters.createdBy;
    if (filters?.dateFrom || filters?.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
        ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
      };
    }
    if (filters?.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { product: { name: { contains: q, mode: 'insensitive' } } },
        { product: { sku: { contains: q, mode: 'insensitive' } } },
        { deal: { client: { companyName: { contains: q, mode: 'insensitive' } } } },
        { deal: { title: { contains: q, mode: 'insensitive' } } },
        { note: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.inventoryMovement.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true } },
        deal: {
          select: {
            id: true,
            title: true,
            closedAt: true,
            createdAt: true,
            isReceiptPunched: true,
            client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
    const creators = creatorIds.length
      ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true } })
      : [];
    const creatorMap = new Map(creators.map((c) => [c.id, c.fullName]));

    return rows.map((r) => ({
      ...this.attachEventDate(r),
      creatorName: creatorMap.get(r.createdBy) ?? null,
    }));
  }

  async getProductMovements(productId: string) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    const rows = await prisma.inventoryMovement.findMany({
      where: { productId },
      include: {
        deal: {
          select: {
            id: true,
            title: true,
            closedAt: true,
            createdAt: true,
            isReceiptPunched: true,
            client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.attachEventDate(r));
  }

  /**
   * `eventDate` — бизнес-дата движения товара:
   *  – для связанного со сделкой движения: `closed_at` сделки (а если не закрыта — `created_at`);
   *  – иначе fallback на `created_at` самой записи движения.
   * Реальное `created_at` остаётся в БД и возвращается клиенту нетронутым (audit-trail).
   */
  private attachEventDate<
    T extends {
      createdAt: Date;
      deal?: { closedAt: Date | null; createdAt: Date } | null;
    },
  >(row: T): T & { eventDate: Date } {
    const deal = row.deal;
    const eventDate = deal ? (deal.closedAt ?? deal.createdAt) : row.createdAt;
    return { ...row, eventDate };
  }

  async getProductAuditHistory(productId?: string) {
    if (!productId) {
      return prisma.auditLog.findMany({
        where: {
          entityType: { in: ['product', 'inventory_movement', 'stock_correction'] },
        },
        include: {
          user: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    const movementIds = await prisma.inventoryMovement.findMany({
      where: { productId },
      select: { id: true },
    });

    return prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'product', entityId: productId },
          { entityType: 'stock_correction', entityId: productId },
          {
            entityType: 'inventory_movement',
            entityId: { in: movementIds.map((movement) => movement.id) },
          },
        ],
      },
      include: {
        user: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getProductAnalytics(
    productId: string,
    period: number | 'all',
    granularityParam?: string | null,
  ) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    const from =
      period === 'all'
        ? null
        : (() => {
            const d = new Date();
            d.setDate(d.getDate() - period);
            return d;
          })();

    // Бизнес-дата движения: для движений, привязанных к сделке —
    // COALESCE(d.closed_at, d.created_at), иначе m.created_at.
    // Фильтр периода и группировка графика идут именно по этой дате,
    // чтобы ретроактивные правки складов не «съезжали» на сегодня.
    const businessDate = sqlInventoryMovementBusinessDate('m', 'd');
    const movementDateFilter = from
      ? Prisma.sql`AND ${businessDate} >= ${from}`
      : Prisma.empty;
    const dealDateFilter = from ? Prisma.sql`AND d.created_at >= ${from}` : Prisma.empty;

    const { granularity, allowed } = resolveProductChartGranularity(period, granularityParam);
    const bucketExpr = sqlInventoryMovementBucket(granularity);

    const [totalsRow, seriesRows, correctionsOutsideRow, dealItems, topClientsRaw] = await Promise.all([
      prisma.$queryRaw<{ total_in: string; total_sale: string }[]>(
        Prisma.sql`
        SELECT
          COALESCE(SUM(CASE WHEN m.type = 'IN' THEN m.quantity::numeric ELSE 0 END), 0)::text AS total_in,
          COALESCE(SUM(CASE WHEN m.type = 'OUT' THEN m.quantity::numeric ELSE 0 END), 0)::text AS total_sale
        FROM inventory_movements m
        LEFT JOIN deals d ON d.id = m.deal_id
        WHERE m.product_id = ${productId}
          ${movementDateFilter}
          AND ${sqlMovementIncludedInProductAnalytics('m')}`,
      ),
      prisma.$queryRaw<{ bucket: Date; in_qty: string; sale_qty: string }[]>(
        Prisma.sql`
        SELECT
          ${bucketExpr} AS bucket,
          COALESCE(SUM(CASE WHEN m.type = 'IN' THEN m.quantity::numeric ELSE 0 END), 0)::text AS in_qty,
          COALESCE(SUM(CASE WHEN m.type = 'OUT' THEN m.quantity::numeric ELSE 0 END), 0)::text AS sale_qty
        FROM inventory_movements m
        LEFT JOIN deals d ON d.id = m.deal_id
        WHERE m.product_id = ${productId}
          ${movementDateFilter}
          AND ${sqlMovementIncludedInProductAnalytics('m')}
        GROUP BY 1
        ORDER BY 1`,
      ),
      prisma.$queryRaw<{ qty: string }[]>(
        Prisma.sql`
        SELECT COALESCE(SUM(m.quantity::numeric), 0)::text AS qty
        FROM inventory_movements m
        LEFT JOIN deals d ON d.id = m.deal_id
        WHERE m.product_id = ${productId}
          ${movementDateFilter}
          AND ${sqlMovementIsAnalyticsCorrection('m')}`,
      ),
      prisma.dealItem.findMany({
        where: {
          productId,
          deal: {
            ...(from ? { createdAt: { gte: from } } : {}),
            status: 'CLOSED',
          },
        },
        select: { requestedQty: true, price: true, deal: { select: { id: true, clientId: true, status: true } } },
      }),
      prisma.$queryRaw<{ client_id: string; company_name: string; is_svip: boolean; total_qty: number }[]>(
        Prisma.sql`
          SELECT c.id as client_id, c.company_name, c.is_svip as is_svip, COALESCE(SUM(di.requested_qty), 0)::int as total_qty
          FROM deal_items di
          JOIN deals d ON d.id = di.deal_id
          JOIN clients c ON c.id = d.client_id
          WHERE di.product_id = ${productId}
            ${dealDateFilter}
            AND d.status = 'CLOSED'
            AND di.requested_qty > 0
          GROUP BY c.id, c.company_name, c.is_svip
          ORDER BY total_qty DESC
          LIMIT 10
        `,
      ),
    ]);

    const t = totalsRow[0];
    const totalIn = t ? Number(t.total_in) : 0;
    const totalOut = t ? Number(t.total_sale) : 0;
    const correctionsOutsideAnalytics = correctionsOutsideRow[0] ? Number(correctionsOutsideRow[0].qty) : 0;

    const movementsByDay = seriesRows.map((r) => ({
      day: r.bucket.toISOString().slice(0, 10),
      inQty: Number(r.in_qty),
      outQty: Number(r.sale_qty),
    }));

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
      movements: {
        totalIn,
        totalOut,
        /** Сумма коррекций за период; не входит в график и итоги аналитики (справочно). */
        correctionsOutsideAnalytics,
        movementsByDay,
        chartGranularity: granularity,
        allowedChartGranularities: allowed,
      },
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
        isSvip: !!r.is_svip,
        totalQty: Number(r.total_qty),
      })),
    };
  }

  /**
   * Parse stock value from Excel format: "5(171,4)" -> 5, "10.5" -> 10.5, "100" -> 100
   * Takes only the first number before any parentheses or other characters
   */
  private parseStockValue(value: unknown): number {
    if (!value) return 0;
    const str = String(value).trim();
    if (!str) return 0;

    // Extract first number: "5(171,4)" → "5", "10.5" → "10.5", "100" → "100"
    const match = str.match(/^(\d+(?:[.,]\d+)?)/);
    if (!match) return 0;

    const num = parseFloat(match[1].replace(',', '.'));
    return isNaN(num) ? 0 : num;
  }

  /**
   * Parse Excel sheet into product rows
   */
  private parseExcelRows(buffer: Buffer): Array<Record<string, unknown>> {
    const xlsx = require('xlsx');
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    if (!sheet) throw new Error('Excel файл пуст');

    // Convert to array of objects, starting from row 2 (skip header)
    const rows: Array<Record<string, unknown>> = [];
    let rowNum = 2;

    for (let i = 2; i <= 1000; i++) {
      const cellB = sheet[`B${i}`];
      const cellC = sheet[`C${i}`];
      const cellD = sheet[`D${i}`];
      const cellH = sheet[`H${i}`];

      // Stop if all cells empty
      if (!cellB && !cellC && !cellD && !cellH) break;

      if (cellB?.v) {
        rows.push({
          rowNum,
          name: cellB.v,
          format: cellC?.v || '',
          unit: cellD?.v || 'шт',
          stock: cellH?.v || 0,
        });
      }
      rowNum++;
    }

    return rows;
  }

  /**
   * Import products from Excel file
   */
  async importProductsFromExcel(
    buffer: Buffer,
    userId: string,
  ): Promise<ImportExcelResult> {
    const result: ImportExcelResult = {
      successCount: 0,
      errorCount: 0,
      errors: [],
      skipped: 0,
    };

    let rows: Array<Record<string, unknown>>;
    try {
      rows = this.parseExcelRows(buffer);
    } catch (err) {
      throw new AppError(400, `Ошибка чтения Excel: ${(err as Error).message}`);
    }

    if (rows.length === 0) {
      throw new AppError(400, 'В файле нет данных для импорта');
    }

    // Process each row
    for (const row of rows) {
      try {
        const name = String(row.name).trim();
        const format = row.format ? String(row.format).trim() : undefined;
        const unit = String(row.unit).trim() || 'шт';
        const stock = this.parseStockValue(row.stock);

        // Validate
        if (!name || name.length === 0) {
          result.errors.push({
            row: row.rowNum as number,
            reason: 'Название товара пусто',
          });
          result.errorCount++;
          continue;
        }

        if (stock < 0) {
          result.errors.push({
            row: row.rowNum as number,
            reason: `Некорректный остаток: ${row.stock}`,
          });
          result.errorCount++;
          continue;
        }

        // Generate unique SKU
        const timestamp = Date.now();
        const index = result.successCount + 1;
        const sku = `IMPORT-${timestamp}-${index}`;

        // Create product in transaction
        await prisma.$transaction(async (tx) => {
          // Create product
          const product = await tx.product.create({
            data: {
              name,
              sku,
              unit,
              format: format || null,
              stock: stock,
              minStock: 0,
              isActive: true,
            },
          });

          // Create initial stock movement (IN)
          if (stock > 0) {
            await tx.inventoryMovement.create({
              data: {
                productId: product.id,
                type: 'IN',
                quantity: stock,
                note: `Начальный остаток при импорте из Excel`,
                createdBy: userId,
              },
            });
          }
        });

        result.successCount++;
      } catch (err) {
        const reason = (err as Error).message || 'Неизвестная ошибка';
        result.errors.push({
          row: row.rowNum as number,
          reason,
        });
        result.errorCount++;
      }
    }

    return result;
  }

}

export const warehouseService = new WarehouseService();
