import { DealStatus, PaymentStatus as PrismaPaymentStatus, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser, ownerScope } from '../../lib/scope';
import {
  CreateDealDto, UpdateDealDto, CreateCommentDto, PaymentDto,
  AddDealItemDto, WarehouseResponseDto, SetItemQuantitiesDto,
  ShipmentDto, FinanceRejectDto,
  CreatePaymentRecordDto, ShipmentHoldDto,
} from './deals.dto';

// ==================== STATUS WORKFLOW ====================

const STATUS_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  NEW: ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS: ['WAITING_STOCK_CONFIRMATION', 'CANCELED'],
  WAITING_STOCK_CONFIRMATION: ['STOCK_CONFIRMED', 'CANCELED'],
  STOCK_CONFIRMED: ['FINANCE_APPROVED', 'REJECTED', 'CANCELED'],
  FINANCE_APPROVED: ['ADMIN_APPROVED', 'CANCELED'],
  ADMIN_APPROVED: ['READY_FOR_SHIPMENT', 'CANCELED'],
  READY_FOR_SHIPMENT: ['SHIPPED', 'SHIPMENT_ON_HOLD', 'CANCELED'],
  SHIPMENT_ON_HOLD: ['READY_FOR_SHIPMENT', 'CANCELED'],
  SHIPPED: ['CLOSED'],
  CLOSED: [],
  CANCELED: [],
  REJECTED: ['IN_PROGRESS'],
};

const STATUS_ROLE_PERMISSIONS: Partial<Record<DealStatus, Role[]>> = {
  IN_PROGRESS: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  WAITING_STOCK_CONFIRMATION: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  STOCK_CONFIRMED: ['WAREHOUSE', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  FINANCE_APPROVED: ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'],
  ADMIN_APPROVED: ['ADMIN', 'SUPER_ADMIN'],
  READY_FOR_SHIPMENT: ['ADMIN', 'SUPER_ADMIN'],
  SHIPPED: ['WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  SHIPMENT_ON_HOLD: ['WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  CLOSED: ['ADMIN', 'SUPER_ADMIN'],
  CANCELED: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  REJECTED: ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'],
};

function validateStatusTransition(from: DealStatus, to: DealStatus, userRole: Role): void {
  const allowed = STATUS_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new AppError(400, `Нельзя перейти из статуса "${from}" в "${to}"`);
  }

  const rolesAllowed = STATUS_ROLE_PERMISSIONS[to];
  if (rolesAllowed && !rolesAllowed.includes(userRole)) {
    throw new AppError(403, `Роль "${userRole}" не может установить статус "${to}"`);
  }
}

// ==================== SERVICE ====================

export class DealsService {
  async findAll(user: AuthUser, filters?: { status?: DealStatus; includeClosed?: boolean }) {
    const where: Record<string, unknown> = {
      ...ownerScope(user),
      isArchived: false,
    };

    if (filters?.status) {
      where.status = filters.status;
    } else if (!filters?.includeClosed) {
      where.status = { not: 'CLOSED' as DealStatus };
    }

    return prisma.deal.findMany({
      where,
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        _count: { select: { comments: true, items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id, ...ownerScope(user) },
      include: {
        client: { select: { id: true, companyName: true, contactName: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, stock: true } },
            confirmer: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        comments: {
          include: { author: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        shipment: {
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    return deal;
  }

  // ==================== CREATE (simplified — no amounts) ====================

  async create(dto: CreateDealDto, user: AuthUser) {
    // Verify client
    const client = await prisma.client.findFirst({
      where: { id: dto.clientId, ...ownerScope(user), isArchived: false },
    });
    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    // Verify contract if provided
    if (dto.contractId) {
      const contract = await prisma.contract.findFirst({
        where: { id: dto.contractId, clientId: dto.clientId },
      });
      if (!contract) {
        throw new AppError(404, 'Договор не найден или не принадлежит данному клиенту');
      }
    }

    // Auto-generate title
    const title = dto.title || `Сделка от ${new Date().toLocaleDateString('ru-RU')}`;

    // Transaction: create deal + items (no amount calculation — amount stays 0)
    const deal = await prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          title,
          amount: 0,
          discount: 0,
          clientId: dto.clientId,
          managerId: user.userId,
          contractId: dto.contractId,
          paymentType: 'FULL',
          paidAmount: 0,
          paymentStatus: 'UNPAID',
        },
      });

      // Create all items (only productId + requestComment)
      for (const item of dto.items) {
        await tx.dealItem.create({
          data: {
            dealId: created.id,
            productId: item.productId,
            requestComment: item.requestComment,
          },
        });
      }

      return created;
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'deal',
      entityId: deal.id,
      after: {
        title: deal.title,
        amount: 0,
        status: deal.status,
        clientId: deal.clientId,
        itemsCount: dto.items.length,
      },
    });

    // Return with includes
    return prisma.deal.findUnique({
      where: { id: deal.id },
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        },
      },
    });
  }

  // ==================== UPDATE ====================

  async update(id: string, dto: UpdateDealDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id, ...ownerScope(user), isArchived: false },
      include: { _count: { select: { items: true } } },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const before: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};

    if (dto.title !== undefined) {
      before.title = deal.title;
      data.title = dto.title;
    }
    if (dto.discount !== undefined) {
      before.discount = Number(deal.discount);
      data.discount = dto.discount;
    }
    if (dto.terms !== undefined) {
      before.terms = deal.terms;
      data.terms = dto.terms;
    }
    if (dto.contractId !== undefined) {
      before.contractId = deal.contractId;
      if (dto.contractId !== null) {
        const contract = await prisma.contract.findFirst({
          where: { id: dto.contractId, clientId: deal.clientId },
        });
        if (!contract) {
          throw new AppError(404, 'Договор не найден или не принадлежит данному клиенту');
        }
      }
      data.contractId = dto.contractId;
    }

    // Manager change (admin only)
    if (dto.managerId !== undefined && dto.managerId !== deal.managerId) {
      const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
      if (!isAdmin) {
        throw new AppError(403, 'Только администратор может менять менеджера сделки');
      }
      const manager = await prisma.user.findUnique({ where: { id: dto.managerId } });
      if (!manager || !manager.isActive) {
        throw new AppError(404, 'Менеджер не найден или неактивен');
      }
      before.managerId = deal.managerId;
      data.managerId = dto.managerId;
    }

    // Status change handling with strict workflow enforcement
    if (dto.status !== undefined && dto.status !== deal.status) {
      validateStatusTransition(deal.status, dto.status as DealStatus, user.role);

      // Require items for WAITING_STOCK_CONFIRMATION
      if (dto.status === 'WAITING_STOCK_CONFIRMATION') {
        if (deal._count.items === 0) {
          throw new AppError(400, 'Нельзя отправить на подтверждение склада сделку без товаров');
        }
      }

      before.status = deal.status;
      data.status = dto.status;

      await auditLog({
        userId: user.userId,
        action: 'STATUS_CHANGE',
        entityType: 'deal',
        entityId: id,
        before: { status: deal.status },
        after: { status: dto.status },
      });
    }

    if (Object.keys(data).length === 0) {
      throw new AppError(400, 'Нет данных для обновления');
    }

    const updated = await prisma.deal.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
      },
    });

    // If discount changed, recalculate amount
    if (dto.discount !== undefined) {
      await this.recalcAmount(id);
    }

    const nonStatusBefore = { ...before };
    delete nonStatusBefore.status;
    if (Object.keys(nonStatusBefore).length > 0) {
      const after: Record<string, unknown> = {};
      if (dto.title !== undefined) after.title = updated.title;
      if (dto.discount !== undefined) after.discount = Number(updated.discount);
      if (dto.terms !== undefined) after.terms = updated.terms;
      if (dto.contractId !== undefined) after.contractId = updated.contractId;
      if (dto.managerId !== undefined) after.managerId = updated.managerId;

      await auditLog({
        userId: user.userId,
        action: 'UPDATE',
        entityType: 'deal',
        entityId: id,
        before: nonStatusBefore,
        after,
      });
    }

    return updated;
  }

  // ==================== WAREHOUSE RESPONSE ====================

  async submitWarehouseResponse(dealId: string, dto: WarehouseResponseDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, isArchived: false },
      include: { items: true },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'WAITING_STOCK_CONFIRMATION') {
      throw new AppError(400, 'Сделка должна быть в статусе "Ожидает подтверждения склада"');
    }

    validateStatusTransition(deal.status, 'STOCK_CONFIRMED', user.role);

    // Validate all items are covered
    const dealItemIds = new Set(deal.items.map((i) => i.id));
    for (const item of dto.items) {
      if (!dealItemIds.has(item.dealItemId)) {
        throw new AppError(400, `Позиция ${item.dealItemId} не найдена в сделке`);
      }
    }

    await prisma.$transaction(async (tx) => {
      // Update each DealItem with warehouse comment only
      for (const item of dto.items) {
        await tx.dealItem.update({
          where: { id: item.dealItemId },
          data: {
            warehouseComment: item.warehouseComment,
            confirmedBy: user.userId,
            confirmedAt: new Date(),
          },
        });
      }

      // Update deal status (no amount recalculation — warehouse only comments)
      await tx.deal.update({
        where: { id: dealId },
        data: { status: 'STOCK_CONFIRMED' },
      });
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'STOCK_CONFIRMED', respondedItems: dto.items.length },
    });

    return this.findById(dealId, user);
  }

  // ==================== SET ITEM QUANTITIES (Manager fills after warehouse response) ====================

  async setItemQuantities(dealId: string, dto: SetItemQuantitiesDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, isArchived: false },
      include: { items: true },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'STOCK_CONFIRMED') {
      throw new AppError(400, 'Сделка должна быть в статусе "Склад подтверждён" для установки количеств');
    }

    // Verify user is manager of this deal or admin
    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
    if (!isAdmin && deal.managerId !== user.userId) {
      throw new AppError(403, 'Только менеджер сделки или администратор может установить количества');
    }

    // Validate all items belong to this deal
    const dealItemIds = new Set(deal.items.map((i) => i.id));
    for (const item of dto.items) {
      if (!dealItemIds.has(item.dealItemId)) {
        throw new AppError(400, `Позиция ${item.dealItemId} не найдена в сделке`);
      }
    }

    // Calculate amounts
    const subtotal = dto.items.reduce((s, i) => s + i.requestedQty * i.price, 0);
    const discount = dto.discount || 0;
    const finalAmount = subtotal - discount;
    if (finalAmount < 0) {
      throw new AppError(400, 'Сумма сделки не может быть отрицательной (скидка превышает подитог)');
    }

    // Payment validation
    let paidAmount = dto.paidAmount || 0;
    if (dto.paymentType === 'FULL') {
      paidAmount = finalAmount;
    }
    if (paidAmount > finalAmount) {
      throw new AppError(400, 'Оплата не может превышать сумму сделки');
    }
    if ((dto.paymentType === 'PARTIAL' || dto.paymentType === 'DEBT') && !dto.dueDate) {
      throw new AppError(400, 'Укажите срок оплаты для частичной оплаты или долга');
    }

    // Auto-compute paymentStatus
    let paymentStatus: PrismaPaymentStatus = 'UNPAID';
    if (paidAmount >= finalAmount && finalAmount > 0) {
      paymentStatus = 'PAID';
    } else if (paidAmount > 0) {
      paymentStatus = 'PARTIAL';
    }

    await prisma.$transaction(async (tx) => {
      // Update each DealItem with requestedQty and price
      for (const item of dto.items) {
        await tx.dealItem.update({
          where: { id: item.dealItemId },
          data: {
            requestedQty: item.requestedQty,
            price: item.price,
          },
        });
      }

      // Update deal with calculated amounts and payment info
      await tx.deal.update({
        where: { id: dealId },
        data: {
          amount: finalAmount,
          discount,
          paymentType: dto.paymentType || 'FULL',
          paidAmount,
          paymentStatus,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          terms: dto.terms,
        },
      });
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'deal',
      entityId: dealId,
      before: { amount: Number(deal.amount), paidAmount: Number(deal.paidAmount) },
      after: { amount: finalAmount, paidAmount, paymentStatus, discount },
    });

    return this.findById(dealId, user);
  }

  async findForStockConfirmation(user: AuthUser) {
    return prisma.deal.findMany({
      where: {
        status: 'WAITING_STOCK_CONFIRMATION',
        isArchived: false,
      },
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, stock: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==================== FINANCE APPROVE / REJECT ====================

  async approveFinance(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'STOCK_CONFIRMED') {
      throw new AppError(400, 'Сделка должна быть в статусе "Склад подтверждён" для финансового одобрения');
    }

    validateStatusTransition(deal.status, 'FINANCE_APPROVED', user.role);

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: 'FINANCE_APPROVED' },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'FINANCE_APPROVED' },
    });

    return this.findById(dealId, user);
  }

  async rejectFinance(dealId: string, dto: FinanceRejectDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'STOCK_CONFIRMED') {
      throw new AppError(400, 'Сделка должна быть в статусе "Склад подтверждён" для отклонения');
    }

    validateStatusTransition(deal.status, 'REJECTED', user.role);

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: 'REJECTED' },
    });

    // Add rejection reason as comment
    await prisma.dealComment.create({
      data: {
        dealId,
        authorId: user.userId,
        text: `Отклонено бухгалтером: ${dto.reason}`,
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'REJECTED', reason: dto.reason },
    });

    return this.findById(dealId, user);
  }

  // ==================== ADMIN APPROVE ====================

  async approveAdmin(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'FINANCE_APPROVED') {
      throw new AppError(400, 'Сделка должна быть в статусе "Финансы одобрены" для одобрения администратором');
    }

    validateStatusTransition(deal.status, 'ADMIN_APPROVED', user.role);

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: 'ADMIN_APPROVED' },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'ADMIN_APPROVED' },
    });

    return this.findById(dealId, user);
  }

  // ==================== WORKFLOW QUEUES ====================

  async findForFinanceReview(user: AuthUser) {
    const deals = await prisma.deal.findMany({
      where: {
        status: 'STOCK_CONFIRMED',
        isArchived: false,
      },
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Compute client debt for each deal
    const clientIds = [...new Set(deals.map((d) => d.clientId))];
    const debtAgg = await prisma.deal.groupBy({
      by: ['clientId'],
      where: {
        clientId: { in: clientIds },
        status: { notIn: ['CANCELED', 'REJECTED', 'CLOSED'] },
        isArchived: false,
      },
      _sum: { amount: true, paidAmount: true },
    });

    const debtMap = new Map<string, number>();
    for (const row of debtAgg) {
      const totalAmount = Number(row._sum.amount ?? 0);
      const totalPaid = Number(row._sum.paidAmount ?? 0);
      debtMap.set(row.clientId, Math.max(0, totalAmount - totalPaid));
    }

    return deals.map((d) => ({
      ...d,
      clientDebt: debtMap.get(d.clientId) ?? 0,
    }));
  }

  async findForShipment(user: AuthUser) {
    return prisma.deal.findMany({
      where: {
        status: 'READY_FOR_SHIPMENT',
        isArchived: false,
      },
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, stock: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==================== SHIPMENT HOLD ====================

  async holdShipment(dealId: string, dto: ShipmentHoldDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'READY_FOR_SHIPMENT') {
      throw new AppError(400, 'Сделка должна быть в статусе "Готова к отгрузке" для приостановки');
    }

    validateStatusTransition(deal.status, 'SHIPMENT_ON_HOLD', user.role);

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: 'SHIPMENT_ON_HOLD' },
    });

    await prisma.dealComment.create({
      data: {
        dealId,
        authorId: user.userId,
        text: `Отгрузка приостановлена: ${dto.reason}`,
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'SHIPMENT_ON_HOLD', reason: dto.reason },
    });

    return this.findById(dealId, user);
  }

  async releaseShipmentHold(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'SHIPMENT_ON_HOLD') {
      throw new AppError(400, 'Сделка должна быть в статусе "Отгрузка приостановлена"');
    }

    validateStatusTransition(deal.status, 'READY_FOR_SHIPMENT', user.role);

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: 'READY_FOR_SHIPMENT' },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'READY_FOR_SHIPMENT' },
    });

    return this.findById(dealId, user);
  }

  // ==================== SHIPMENT ====================

  async submitShipment(dealId: string, dto: ShipmentDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'READY_FOR_SHIPMENT') {
      throw new AppError(400, 'Сделка должна быть в статусе "Готова к отгрузке" для оформления отгрузки');
    }

    validateStatusTransition(deal.status, 'SHIPPED', user.role);

    const dealItems = await prisma.dealItem.findMany({
      where: { dealId },
      include: { product: true },
    });

    await prisma.$transaction(async (tx) => {
      // Deduct stock for each item atomically
      for (const item of dealItems) {
        const qty = Number(item.requestedQty ?? 0);
        if (qty <= 0) continue;

        const result = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: qty } },
          data: { stock: { decrement: qty } },
        });

        if (result.count === 0) {
          throw new AppError(400,
            `Недостаточно товара "${item.product.name}" на складе. Остаток: ${Number(item.product.stock)}, требуется: ${qty}`,
          );
        }

        // Create inventory movement (OUT)
        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            type: 'OUT',
            quantity: qty,
            dealId,
            note: 'Автосписание при отгрузке',
            createdBy: user.userId,
          },
        });
      }

      // Create shipment record
      await tx.shipment.create({
        data: {
          dealId,
          vehicleType: dto.vehicleType,
          vehicleNumber: dto.vehicleNumber,
          driverName: dto.driverName,
          departureTime: new Date(dto.departureTime),
          deliveryNoteNumber: dto.deliveryNoteNumber,
          shipmentComment: dto.shipmentComment,
          shippedBy: user.userId,
        },
      });

      // Update deal status
      await tx.deal.update({
        where: { id: dealId },
        data: { status: 'SHIPPED' },
      });
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: {
        status: 'SHIPPED',
        vehicleNumber: dto.vehicleNumber,
        driverName: dto.driverName,
        deliveryNoteNumber: dto.deliveryNoteNumber,
      },
    });

    // Stock write-off audit log
    await auditLog({
      userId: user.userId,
      action: 'STOCK_WRITE_OFF',
      entityType: 'deal',
      entityId: dealId,
      after: {
        items: dealItems.map((i) => ({
          product: i.product.name,
          quantity: Number(i.requestedQty ?? 0),
        })),
      },
    });

    return this.findById(dealId, user);
  }

  async getShipment(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user) },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    return prisma.shipment.findUnique({
      where: { dealId },
      include: {
        user: { select: { id: true, fullName: true } },
      },
    });
  }

  // ==================== PAYMENT ====================

  async updatePayment(id: string, dto: PaymentDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const amount = Number(deal.amount);

    // Validate paidAmount doesn't exceed deal amount
    if (dto.paidAmount > amount) {
      throw new AppError(400, 'Оплата не может превышать сумму сделки');
    }

    const before = {
      paidAmount: Number(deal.paidAmount),
      paymentType: deal.paymentType,
      paymentStatus: deal.paymentStatus,
      dueDate: deal.dueDate,
      terms: deal.terms,
    };

    // Auto-compute paymentStatus
    let paymentStatus: PrismaPaymentStatus;
    if (dto.paidAmount === 0) {
      paymentStatus = 'UNPAID';
    } else if (dto.paidAmount >= amount) {
      paymentStatus = 'PAID';
    } else {
      paymentStatus = 'PARTIAL';
    }

    const data: Record<string, unknown> = {
      paidAmount: dto.paidAmount,
      paymentStatus,
    };

    if (dto.paymentType !== undefined) {
      data.paymentType = dto.paymentType;
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.terms !== undefined) {
      data.terms = dto.terms;
    }

    const updated = await prisma.deal.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE',
      entityType: 'deal',
      entityId: id,
      before,
      after: {
        paidAmount: Number(updated.paidAmount),
        paymentType: updated.paymentType,
        paymentStatus: updated.paymentStatus,
        dueDate: updated.dueDate,
        terms: updated.terms,
      },
    });

    return updated;
  }

  // ==================== PAYMENT RECORDS ====================

  async createPaymentRecord(dealId: string, dto: CreatePaymentRecordDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const amount = Number(deal.amount);
    const currentPaid = Number(deal.paidAmount);
    const newTotal = currentPaid + dto.amount;

    if (newTotal > amount) {
      throw new AppError(400, `Сумма платежей (${newTotal}) превышает сумму сделки (${amount})`);
    }

    // Auto-compute paymentStatus
    let paymentStatus: PrismaPaymentStatus;
    if (newTotal === 0) {
      paymentStatus = 'UNPAID';
    } else if (newTotal >= amount) {
      paymentStatus = 'PAID';
    } else {
      paymentStatus = 'PARTIAL';
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          dealId,
          clientId: deal.clientId,
          amount: dto.amount,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          method: dto.method,
          note: dto.note,
          createdBy: user.userId,
        },
        include: {
          creator: { select: { id: true, fullName: true } },
        },
      });

      await tx.deal.update({
        where: { id: dealId },
        data: { paidAmount: newTotal, paymentStatus },
      });

      return created;
    });

    await auditLog({
      userId: user.userId,
      action: 'PAYMENT_CREATE',
      entityType: 'deal',
      entityId: dealId,
      after: {
        paymentId: payment.id,
        amount: dto.amount,
        newPaidAmount: newTotal,
        paymentStatus,
      },
    });

    return payment;
  }

  async getDealPayments(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user) },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    return prisma.payment.findMany({
      where: { dealId },
      include: {
        creator: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  // ==================== DEAL ITEMS ====================

  private async recalcAmount(dealId: string) {
    const items = await prisma.dealItem.findMany({ where: { dealId } });
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return;

    const subtotal = items.reduce((s, i) => s + Number(i.requestedQty ?? 0) * Number(i.price ?? 0), 0);
    const finalAmount = Math.max(0, subtotal - Number(deal.discount));

    await prisma.deal.update({
      where: { id: dealId },
      data: { amount: finalAmount },
    });
  }

  async getItems(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user) },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    return prisma.dealItem.findMany({
      where: { dealId },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true, stock: true } },
        confirmer: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addItem(dealId: string, dto: AddDealItemDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const product = await prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || !product.isActive) {
      throw new AppError(404, 'Товар не найден или неактивен');
    }

    const item = await prisma.dealItem.create({
      data: {
        dealId,
        productId: dto.productId,
        requestComment: dto.requestComment,
      },
      include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
    });

    return item;
  }

  async removeItem(dealId: string, itemId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const item = await prisma.dealItem.findFirst({
      where: { id: itemId, dealId },
    });

    if (!item) {
      throw new AppError(404, 'Позиция не найдена');
    }

    await prisma.dealItem.delete({ where: { id: itemId } });

    // Recalculate deal amount
    await this.recalcAmount(dealId);

    return { success: true };
  }

  // ==================== ARCHIVE ====================

  async archive(id: string, user: AuthUser) {
    const canArchive = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.permissions.includes('archive_deals');
    if (!canArchive) {
      throw new AppError(403, 'Недостаточно прав для архивирования сделки');
    }

    const deal = await prisma.deal.findUnique({ where: { id } });
    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const updated = await prisma.deal.update({
      where: { id },
      data: { isArchived: true },
    });

    await auditLog({
      userId: user.userId,
      action: 'ARCHIVE',
      entityType: 'deal',
      entityId: id,
      before: { isArchived: false },
      after: { isArchived: true },
    });

    return updated;
  }

  // ==================== HISTORY & LOGS & COMMENTS ====================

  async getHistory(id: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id, ...ownerScope(user) },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const [logs, movements] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entityType: 'deal', entityId: id },
        include: { user: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryMovement.findMany({
        where: { dealId: id },
        include: { product: { select: { id: true, name: true, sku: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const timeline = [
      ...logs.map((l) => ({ kind: 'audit' as const, ...l })),
      ...movements.map((m) => ({ kind: 'movement' as const, ...m })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return timeline;
  }

  async getLogs(id: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id, ...ownerScope(user) },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    return prisma.auditLog.findMany({
      where: { entityType: 'deal', entityId: id },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addComment(dealId: string, dto: CreateCommentDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const comment = await prisma.dealComment.create({
      data: {
        dealId,
        authorId: user.userId,
        text: dto.text,
      },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    });

    return comment;
  }

  async getComments(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user) },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    return prisma.dealComment.findMany({
      where: { dealId },
      include: { author: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const dealsService = new DealsService();
