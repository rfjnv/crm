import path from 'path';
import fs from 'fs';
import { ImportDocumentType, ImportOrderStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser } from '../../lib/scope';
import { validateUploadedFile, generateStorageName, sanitizeFilename } from '../../lib/uploadSecurity';
import { exchangeRatesService } from '../foreign-trade/exchange-rates.service';
import { moneyService } from '../foreign-trade/money.service';
import {
  CreateImportOrderDto,
  UpdateImportOrderDto,
  ReplaceItemsDto,
  STATUS_PIPELINE,
} from './import-orders.dto';

/**
 * Если пользователь явно не задал invoiceRate — пытаемся подставить курс ЦБ РУз
 * на orderDate для валюты заказа. Для UZS и при ошибках — вернёт null (тихо).
 */
async function resolveInvoiceRate(
  explicit: number | null | undefined,
  currency: string,
  orderDate: string | Date,
): Promise<number | null> {
  if (explicit !== undefined && explicit !== null) return explicit;
  if (currency === 'UZS') return null;
  try {
    const found = await exchangeRatesService.findRate(orderDate, currency);
    return found ? Number(found.rate.toFixed(6)) : null;
  } catch {
    return null;
  }
}

function calcTotal(items: { qty: number; unitPrice: number }[]): number {
  return items.reduce((sum, i) => sum + Number(i.qty) * Number(i.unitPrice), 0);
}

/**
 * Пересчитывает UZS-суммы заказа: totalAmountUzs, overheadUzs, landedCostUzs.
 * Не трогает totalAmount (остаётся в валюте заказа), invoiceRate (фиксируется отдельно).
 * Безопасно при отсутствии курса: поля просто остаются null, заказ не ломается.
 */
export async function recalcImportOrderUzs(orderId: string): Promise<void> {
  const order = await prisma.importOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      currency: true,
      totalAmount: true,
      invoiceRate: true,
    },
  });
  if (!order) return;

  const totalAmount = Number(order.totalAmount);
  const rate = order.invoiceRate != null ? Number(order.invoiceRate) : null;

  let totalAmountUzs: number | null = null;
  if (order.currency === 'UZS') {
    totalAmountUzs = Number(totalAmount.toFixed(2));
  } else if (rate != null) {
    totalAmountUzs = moneyService.applyRate(totalAmount, rate);
  }

  // Сумма связанных расходов в UZS (только одобренные).
  const overheadAgg = await prisma.expense.aggregate({
    where: { importOrderId: orderId, status: 'APPROVED' },
    _sum: { amountUzs: true },
  });
  const overheadUzs = Number(overheadAgg._sum.amountUzs ?? 0);

  const landedCostUzs =
    totalAmountUzs != null ? Number((totalAmountUzs + overheadUzs).toFixed(2)) : null;

  await prisma.importOrder.update({
    where: { id: orderId },
    data: {
      totalAmountUzs,
      overheadUzs,
      landedCostUzs,
    },
  });
}

export class ImportOrdersService {
  async findAll(params: { status?: string; supplierId?: string; search?: string }) {
    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.supplierId) where.supplierId = params.supplierId;
    if (params.search) {
      where.OR = [
        { number: { contains: params.search, mode: 'insensitive' } },
        { invoiceNumber: { contains: params.search, mode: 'insensitive' } },
        { containerNumber: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const orders = await prisma.importOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { id: true, companyName: true, country: true, currency: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { items: true, attachments: true } },
      },
    });

    return orders.map((o) => ({
      ...o,
      itemsCount: o._count.items,
      attachmentsCount: o._count.attachments,
      _count: undefined,
    }));
  }

  async findById(id: string) {
    const order = await prisma.importOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        createdBy: { select: { id: true, fullName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          include: { uploader: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) {
      throw new AppError(404, 'Импортный заказ не найден');
    }

    // MVP-4: прикладываем текущий курс ЦБ + курсовую разницу (не трогает БД).
    let currentRate: number | null = null;
    let currentRateDate: string | null = null;
    let currencyDiffUzs: number | null = null;
    const invoiceRate = order.invoiceRate != null ? Number(order.invoiceRate) : null;

    if (order.currency !== 'UZS') {
      try {
        const found = await exchangeRatesService.findRate(new Date(), order.currency);
        if (found) {
          currentRate = Number(found.rate.toFixed(6));
          currentRateDate = found.sourceDate;
          if (invoiceRate != null) {
            const diffPerUnit = currentRate - invoiceRate;
            currencyDiffUzs = Number((diffPerUnit * Number(order.totalAmount)).toFixed(2));
          }
        }
      } catch {
        /* swallow — отчёт best-effort */
      }
    }

    return {
      ...order,
      currentRate,
      currentRateDate,
      currencyDiffUzs,
    };
  }

  async create(dto: CreateImportOrderDto, user: AuthUser) {
    const supplier = await prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier) {
      throw new AppError(404, 'Поставщик не найден');
    }

    const existing = await prisma.importOrder.findUnique({ where: { number: dto.number } });
    if (existing) {
      throw new AppError(409, 'Импортный заказ с таким номером уже существует');
    }

    if (dto.items && dto.items.length > 0) {
      const productIds = dto.items.map((i) => i.productId);
      const found = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      if (found.length !== new Set(productIds).size) {
        throw new AppError(404, 'Один или несколько товаров не найдены');
      }
    }

    const total = calcTotal(dto.items || []);
    const effectiveCurrency = dto.currency ?? supplier.currency;
    const effectiveRate = await resolveInvoiceRate(dto.invoiceRate, effectiveCurrency, dto.orderDate);

    const order = await prisma.importOrder.create({
      data: {
        number: dto.number,
        supplierId: dto.supplierId,
        createdById: user.userId,
        currency: effectiveCurrency,
        orderDate: new Date(dto.orderDate),
        etd: dto.etd ? new Date(dto.etd) : null,
        eta: dto.eta ? new Date(dto.eta) : null,
        containerNumber: dto.containerNumber ?? null,
        invoiceNumber: dto.invoiceNumber ?? null,
        invoiceRate: effectiveRate,
        totalAmount: total,
        notes: dto.notes ?? null,
        items: dto.items && dto.items.length > 0
          ? {
              create: dto.items.map((i) => ({
                productId: i.productId,
                qty: i.qty,
                unitPrice: i.unitPrice,
                lineTotal: Number((i.qty * i.unitPrice).toFixed(2)),
                comment: i.comment ?? null,
              })),
            }
          : undefined,
      },
      include: {
        supplier: { select: { id: true, companyName: true } },
        items: true,
      },
    });

    await recalcImportOrderUzs(order.id);

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'import_order',
      entityId: order.id,
      after: {
        number: order.number,
        supplierId: order.supplierId,
        currency: order.currency,
        totalAmount: order.totalAmount,
        itemsCount: order.items.length,
      },
    });

    return prisma.importOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        supplier: { select: { id: true, companyName: true } },
        items: true,
      },
    });
  }

  async update(id: string, dto: UpdateImportOrderDto, user: AuthUser) {
    const order = await prisma.importOrder.findUnique({ where: { id } });
    if (!order) {
      throw new AppError(404, 'Импортный заказ не найден');
    }
    if (order.status === 'RECEIVED' || order.status === 'CANCELED') {
      throw new AppError(400, 'Нельзя редактировать заказ в финальном статусе');
    }

    if (dto.number && dto.number !== order.number) {
      const dup = await prisma.importOrder.findUnique({ where: { number: dto.number } });
      if (dup) throw new AppError(409, 'Номер уже используется');
    }

    if (dto.supplierId && dto.supplierId !== order.supplierId) {
      const s = await prisma.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!s) throw new AppError(404, 'Поставщик не найден');
    }

    const before = {
      number: order.number,
      supplierId: order.supplierId,
      currency: order.currency,
      orderDate: order.orderDate,
      etd: order.etd,
      eta: order.eta,
      invoiceNumber: order.invoiceNumber,
      containerNumber: order.containerNumber,
    };

    const data: Record<string, unknown> = {};
    if (dto.number !== undefined) data.number = dto.number;
    if (dto.supplierId !== undefined) data.supplierId = dto.supplierId;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.orderDate !== undefined) data.orderDate = new Date(dto.orderDate);
    if (dto.etd !== undefined) data.etd = dto.etd ? new Date(dto.etd) : null;
    if (dto.eta !== undefined) data.eta = dto.eta ? new Date(dto.eta) : null;
    if (dto.containerNumber !== undefined) data.containerNumber = dto.containerNumber;
    if (dto.invoiceNumber !== undefined) data.invoiceNumber = dto.invoiceNumber;
    if (dto.invoiceRate !== undefined) data.invoiceRate = dto.invoiceRate;
    if (dto.notes !== undefined) data.notes = dto.notes;

    // Автоподстановка курса: если пользователь НЕ задал invoiceRate явно,
    // но меняет currency/orderDate — попробуем подтянуть из ExchangeRate.
    const currencyChanged = dto.currency !== undefined && dto.currency !== order.currency;
    const orderDateChanged =
      dto.orderDate !== undefined &&
      new Date(dto.orderDate).getTime() !== new Date(order.orderDate).getTime();
    if (dto.invoiceRate === undefined && (currencyChanged || orderDateChanged)) {
      const newCurrency = (dto.currency ?? order.currency) as string;
      const newDate = dto.orderDate ?? order.orderDate;
      const auto = await resolveInvoiceRate(undefined, newCurrency, newDate);
      if (auto !== null) {
        data.invoiceRate = auto;
      }
    }

    const updated = await prisma.importOrder.update({
      where: { id },
      data,
      include: { supplier: { select: { id: true, companyName: true } } },
    });

    await recalcImportOrderUzs(id);

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'import_order',
      entityId: id,
      before,
      after: {
        number: updated.number,
        supplierId: updated.supplierId,
        currency: updated.currency,
        orderDate: updated.orderDate,
        etd: updated.etd,
        eta: updated.eta,
        invoiceNumber: updated.invoiceNumber,
        containerNumber: updated.containerNumber,
      },
    });

    return updated;
  }

  async replaceItems(id: string, dto: ReplaceItemsDto, user: AuthUser) {
    const order = await prisma.importOrder.findUnique({ where: { id } });
    if (!order) throw new AppError(404, 'Импортный заказ не найден');
    if (order.status === 'RECEIVED' || order.status === 'CANCELED') {
      throw new AppError(400, 'Нельзя редактировать позиции в финальном статусе');
    }

    const productIds = dto.items.map((i) => i.productId);
    if (productIds.length > 0) {
      const found = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      if (found.length !== new Set(productIds).size) {
        throw new AppError(404, 'Один или несколько товаров не найдены');
      }
    }

    const total = calcTotal(dto.items);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.importOrderItem.deleteMany({ where: { importOrderId: id } });
      if (dto.items.length > 0) {
        await tx.importOrderItem.createMany({
          data: dto.items.map((i) => ({
            importOrderId: id,
            productId: i.productId,
            qty: i.qty,
            unitPrice: i.unitPrice,
            lineTotal: Number((i.qty * i.unitPrice).toFixed(2)),
            comment: i.comment ?? null,
          })),
        });
      }
      return tx.importOrder.update({
        where: { id },
        data: { totalAmount: total },
        include: {
          items: {
            include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
          },
        },
      });
    });

    await recalcImportOrderUzs(id);

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'import_order',
      entityId: id,
      after: { itemsCount: dto.items.length, totalAmount: total },
      reason: 'replace_items',
    });

    return updated;
  }

  /**
   * Рассчитывает landed cost (полную себестоимость в UZS) по каждой позиции заказа.
   * Overhead (расходы, привязанные к заказу) распределяется пропорционально стоимости
   * позиции в валюте заказа.
   *
   * Возвращает «живое» представление, не пишет в БД (это отчёт).
   */
  async getLandedCost(id: string) {
    const order = await prisma.importOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        expenses: {
          where: { status: 'APPROVED' },
          select: {
            id: true,
            date: true,
            category: true,
            amount: true,
            currency: true,
            amountUzs: true,
            note: true,
          },
          orderBy: { date: 'asc' },
        },
      },
    });

    if (!order) throw new AppError(404, 'Импортный заказ не найден');

    const invoiceRate = order.invoiceRate != null ? Number(order.invoiceRate) : null;
    const totalInOrderCcy = Number(order.totalAmount);
    const totalAmountUzs = order.totalAmountUzs != null ? Number(order.totalAmountUzs) : null;

    const overheadItems = order.expenses.map((e) => ({
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      category: e.category,
      amount: Number(e.amount),
      currency: e.currency ?? 'UZS',
      amountUzs: e.amountUzs != null ? Number(e.amountUzs) : null,
      note: e.note,
    }));
    const overheadUzs = overheadItems.reduce(
      (sum, e) => sum + (e.amountUzs ?? 0),
      0,
    );

    const items = order.items.map((i) => {
      const lineTotal = Number(i.lineTotal);
      const share = totalInOrderCcy > 0 ? lineTotal / totalInOrderCcy : 0;

      const lineTotalUzs =
        order.currency === 'UZS'
          ? lineTotal
          : invoiceRate != null
          ? Number((lineTotal * invoiceRate).toFixed(2))
          : null;

      const allocatedOverheadUzs = Number((overheadUzs * share).toFixed(2));
      const landedUzs =
        lineTotalUzs != null
          ? Number((lineTotalUzs + allocatedOverheadUzs).toFixed(2))
          : null;

      const qty = Number(i.qty);
      const unitLandedUzs = landedUzs != null && qty > 0 ? Number((landedUzs / qty).toFixed(2)) : null;

      return {
        itemId: i.id,
        product: i.product,
        qty,
        unitPrice: Number(i.unitPrice),
        lineTotal,
        sharePct: Number((share * 100).toFixed(2)),
        lineTotalUzs,
        allocatedOverheadUzs,
        landedUzs,
        unitLandedUzs,
      };
    });

    const landedCostUzs =
      totalAmountUzs != null ? Number((totalAmountUzs + overheadUzs).toFixed(2)) : null;

    return {
      orderId: order.id,
      number: order.number,
      currency: order.currency,
      invoiceRate,
      totalInOrderCcy,
      totalAmountUzs,
      overheadUzs: Number(overheadUzs.toFixed(2)),
      landedCostUzs,
      items,
      overheadItems,
    };
  }

  async changeStatus(id: string, nextStatus: ImportOrderStatus, user: AuthUser) {
    const order = await prisma.importOrder.findUnique({ where: { id } });
    if (!order) throw new AppError(404, 'Импортный заказ не найден');

    const allowed = STATUS_PIPELINE[order.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(400, `Недопустимый переход статуса: ${order.status} → ${nextStatus}`);
    }

    const updated = await prisma.importOrder.update({
      where: { id },
      data: { status: nextStatus },
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'import_order',
      entityId: id,
      before: { status: order.status },
      after: { status: updated.status },
      reason: 'status_change',
    });

    return updated;
  }

  // ==================== ATTACHMENTS ====================

  async uploadAttachment(
    importOrderId: string,
    documentType: ImportDocumentType,
    file: Express.Multer.File,
    user: AuthUser,
  ) {
    const order = await prisma.importOrder.findUnique({ where: { id: importOrderId } });
    if (!order) throw new AppError(404, 'Импортный заказ не найден');

    validateUploadedFile(file.buffer, file.mimetype, file.originalname);

    const uploadsDir = path.join(process.cwd(), 'uploads', 'import-orders');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const storageName = generateStorageName(file.originalname);
    const filePath = path.join(uploadsDir, storageName);
    fs.writeFileSync(filePath, file.buffer);

    const attachment = await prisma.importOrderAttachment.create({
      data: {
        importOrderId,
        documentType,
        filename: sanitizeFilename(file.originalname),
        path: `uploads/import-orders/${storageName}`,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: user.userId,
      },
      include: { uploader: { select: { id: true, fullName: true } } },
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'import_order_attachment',
      entityId: attachment.id,
      after: {
        importOrderId,
        documentType,
        filename: attachment.filename,
        size: attachment.size,
      },
    });

    return attachment;
  }

  async deleteAttachment(attachmentId: string, user: AuthUser) {
    const attachment = await prisma.importOrderAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) throw new AppError(404, 'Вложение не найдено');

    const fullPath = path.join(process.cwd(), attachment.path);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
    }

    await prisma.importOrderAttachment.delete({ where: { id: attachmentId } });

    await auditLog({
      userId: user.userId,
      action: 'DELETE',
      entityType: 'import_order_attachment',
      entityId: attachmentId,
      before: {
        importOrderId: attachment.importOrderId,
        filename: attachment.filename,
        documentType: attachment.documentType,
      },
    });

    return { success: true };
  }
}

export const importOrdersService = new ImportOrdersService();
