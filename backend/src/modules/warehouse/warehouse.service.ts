import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors';
import {
  resolveProductChartGranularity,
  sqlInventoryMovementBucket,
  sqlMovementIncludedInProductAnalytics,
  sqlMovementIsAnalyticsCorrection,
} from '../../lib/inventoryAnalytics';
import { auditLog } from '../../lib/logger';
import { CreateProductDto, UpdateProductDto, CreateMovementDto, CorrectStockDto, ImportExcelResult, ImportedProduct } from './warehouse.dto';

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

  async correctStock(id: string, dto: CorrectStockDto, userId: string) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    const oldStock = Number(product.stock);
    const diff = dto.newStock - oldStock;

    // Transactional: update stock + create CORRECTION movement
    const updated = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id },
        data: { stock: dto.newStock },
      });

      // Create CORRECTION movement for history
      await tx.inventoryMovement.create({
        data: {
          productId: id,
          type: 'CORRECTION',
          quantity: Math.abs(diff),
          note: `Коррекция: ${dto.reason} (было ${oldStock}, стало ${dto.newStock})`,
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
      before: { stock: oldStock, name: product.name, sku: product.sku },
      after: { stock: dto.newStock, reason: dto.reason },
      reason: dto.reason,
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
          deal: { select: { id: true, title: true, client: { select: { companyName: true } } } },
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
        deal: { select: { id: true, title: true, client: { select: { companyName: true } } } },
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
        deal: { select: { id: true, title: true, client: { select: { companyName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
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

  async getProductAnalytics(productId: string, periodDays: number, granularityParam?: string | null) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError(404, 'Товар не найден');
    }

    const from = new Date();
    from.setDate(from.getDate() - periodDays);

    const { granularity, allowed } = resolveProductChartGranularity(periodDays, granularityParam);
    const bucketExpr = sqlInventoryMovementBucket(granularity);

    const [totalsRow, seriesRows, correctionsOutsideRow, dealItems, topClientsRaw] = await Promise.all([
      prisma.$queryRaw<{ total_in: string; total_sale: string }[]>(
        Prisma.sql`
        SELECT
          COALESCE(SUM(CASE WHEN m.type = 'IN' THEN m.quantity::numeric ELSE 0 END), 0)::text AS total_in,
          COALESCE(SUM(CASE WHEN m.type = 'OUT' THEN m.quantity::numeric ELSE 0 END), 0)::text AS total_sale
        FROM inventory_movements m
        WHERE m.product_id = ${productId} AND m.created_at >= ${from}
          AND ${sqlMovementIncludedInProductAnalytics('m')}`,
      ),
      prisma.$queryRaw<{ bucket: Date; in_qty: string; sale_qty: string }[]>(
        Prisma.sql`
        SELECT
          ${bucketExpr} AS bucket,
          COALESCE(SUM(CASE WHEN m.type = 'IN' THEN m.quantity::numeric ELSE 0 END), 0)::text AS in_qty,
          COALESCE(SUM(CASE WHEN m.type = 'OUT' THEN m.quantity::numeric ELSE 0 END), 0)::text AS sale_qty
        FROM inventory_movements m
        WHERE m.product_id = ${productId} AND m.created_at >= ${from}
          AND ${sqlMovementIncludedInProductAnalytics('m')}
        GROUP BY 1
        ORDER BY 1`,
      ),
      prisma.$queryRaw<{ qty: string }[]>(
        Prisma.sql`
        SELECT COALESCE(SUM(m.quantity::numeric), 0)::text AS qty
        FROM inventory_movements m
        WHERE m.product_id = ${productId} AND m.created_at >= ${from}
          AND ${sqlMovementIsAnalyticsCorrection('m')}`,
      ),
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
