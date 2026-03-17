import { DealStatus, PaymentStatus as PrismaPaymentStatus, PaymentMethod, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser, ownerScope } from '../../lib/scope';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';
import {
  CreateDealDto, UpdateDealDto, CreateCommentDto, PaymentDto,
  AddDealItemDto, WarehouseResponseDto, SetItemQuantitiesDto,
  ShipmentDto, FinanceRejectDto, SendToFinanceDto,
  CreatePaymentRecordDto, UpdatePaymentRecordDto, ShipmentHoldDto,
  SuperOverrideDealDto,
} from './deals.dto';

// ==================== STATUS WORKFLOW ====================

const STATUS_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  NEW: ['WAITING_STOCK_CONFIRMATION', 'CANCELED'],
  WAITING_STOCK_CONFIRMATION: ['STOCK_CONFIRMED', 'NEW', 'CANCELED'],
  STOCK_CONFIRMED: ['IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'CANCELED'],
  IN_PROGRESS: ['WAITING_FINANCE', 'ADMIN_APPROVED', 'WAITING_STOCK_CONFIRMATION', 'REJECTED', 'CANCELED'],
  WAITING_FINANCE: ['ADMIN_APPROVED', 'IN_PROGRESS', 'REJECTED', 'CANCELED'],
  FINANCE_APPROVED: ['ADMIN_APPROVED', 'CANCELED'],
  ADMIN_APPROVED: ['READY_FOR_SHIPMENT', 'IN_PROGRESS', 'CANCELED'],
  READY_FOR_SHIPMENT: ['CLOSED', 'SHIPMENT_ON_HOLD', 'CANCELED'],
  SHIPMENT_ON_HOLD: ['READY_FOR_SHIPMENT', 'CANCELED'],
  SHIPPED: [],      // deprecated
  PENDING_APPROVAL: [], // deprecated
  CLOSED: [],
  CANCELED: [],
  REJECTED: ['IN_PROGRESS'],
  REOPENED: ['READY_FOR_SHIPMENT', 'CANCELED'],
};

const STATUS_ROLE_PERMISSIONS: Partial<Record<DealStatus, Role[]>> = {
  NEW: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  WAITING_STOCK_CONFIRMATION: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  STOCK_CONFIRMED: ['WAREHOUSE', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  IN_PROGRESS: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  WAITING_FINANCE: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  FINANCE_APPROVED: ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'],
  ADMIN_APPROVED: ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT'],
  READY_FOR_SHIPMENT: ['ADMIN', 'SUPER_ADMIN'],
  SHIPMENT_ON_HOLD: ['WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  CLOSED: ['WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  CANCELED: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  REJECTED: ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'],
  REOPENED: ['ADMIN', 'SUPER_ADMIN'],
};

const FINANCE_REVIEW_METHODS: PaymentMethod[] = ['TRANSFER', 'INSTALLMENT'];
const CONTRACT_REQUIRED_METHODS: PaymentMethod[] = ['TRANSFER', 'INSTALLMENT'];

function requiresFinanceReview(method: PaymentMethod): boolean {
  return FINANCE_REVIEW_METHODS.includes(method);
}

function requiresContract(method: PaymentMethod | null): boolean {
  return !!method && CONTRACT_REQUIRED_METHODS.includes(method);
}

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
      where.status = { notIn: ['CLOSED'] as DealStatus[] };
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
            product: { select: { id: true, name: true, sku: true, unit: true, stock: true, salePrice: true } },
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

  // ==================== CREATE (simplified — client + items + comment only) ====================

  async create(dto: CreateDealDto, user: AuthUser) {
    // Verify client exists (any user can create a deal for any client)
    const client = await prisma.client.findFirst({
      where: { id: dto.clientId, isArchived: false },
    });
    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    // Auto-generate title (use Tashkent timezone for date consistency with analytics)
    const title = dto.title || `Сделка от ${new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' })}`;

    // Compute total amount from items (source of truth)
    const totalAmount = dto.items.reduce((sum, item) => {
      if (item.requestedQty && item.price) {
        return sum + item.requestedQty * item.price;
      }
      return sum;
    }, 0);

    // Smart status: if ALL items have qty > 0 → IN_PROGRESS (skip warehouse)
    // Otherwise → WAITING_STOCK_CONFIRMATION
    const allHaveQty = dto.items.every((i) => i.requestedQty && i.requestedQty > 0);
    const initialStatus = allHaveQty ? 'IN_PROGRESS' : 'WAITING_STOCK_CONFIRMATION';

    // Transaction: create deal + items + optional comment
    const deal = await prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          title,
          amount: totalAmount,
          discount: 0,
          status: initialStatus as any,
          clientId: dto.clientId,
          managerId: user.userId,
          paymentType: 'FULL',
          paidAmount: 0,
          paymentStatus: 'UNPAID',
        },
      });

      for (const item of dto.items) {
        const qty = item.requestedQty ?? 0;
        const price = item.price ?? 0;
        await tx.dealItem.create({
          data: {
            dealId: created.id,
            productId: item.productId,
            requestedQty: item.requestedQty ?? null,
            price: item.price ?? null,
            lineTotal: qty > 0 && price > 0 ? qty * price : null,
            requestComment: item.requestComment,
          },
        });
      }

      // Add initial comment if provided
      if (dto.comment) {
        await tx.dealComment.create({
          data: {
            dealId: created.id,
            authorId: user.userId,
            text: dto.comment,
          },
        });
      }

      // Update client's managerId to track "last served by"
      if (client.managerId !== user.userId) {
        await tx.client.update({
          where: { id: dto.clientId },
          data: { managerId: user.userId },
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
        amount: totalAmount,
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

    // Block non-admin edits on CLOSED deals (check edit_closed_deal permission)
    if (deal.status === 'CLOSED') {
      const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
      const hasPermission = user.permissions.includes('edit_closed_deal');
      if (!isAdmin && !hasPermission) {
        throw new AppError(403, 'Недостаточно прав для редактирования закрытых сделок');
      }
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

  // ==================== SEND TO FINANCE (payment method selection) ====================

  async sendToFinance(dealId: string, dto: SendToFinanceDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
      include: { _count: { select: { items: true } } },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'Сделка должна быть в статусе "В работе" для отправки в финансы');
    }

    if (deal._count.items === 0) {
      throw new AppError(400, 'Нельзя отправить сделку без товаров');
    }

    // Determine target status based on payment method
    const needsFinanceReview = requiresFinanceReview(dto.paymentMethod as PaymentMethod);
    const targetStatus: DealStatus = needsFinanceReview ? 'WAITING_FINANCE' : 'ADMIN_APPROVED';

    validateStatusTransition(deal.status, targetStatus, user.role);

    await prisma.deal.update({
      where: { id: dealId },
      data: {
        status: targetStatus,
        paymentMethod: dto.paymentMethod as PaymentMethod,
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: targetStatus, paymentMethod: dto.paymentMethod },
    });

    // Notify accountants when deal needs finance review
    if (targetStatus === 'WAITING_FINANCE') {
      const accountants = await prisma.user.findMany({
        where: { role: 'ACCOUNTANT', isActive: true },
        select: { id: true },
      });

      if (accountants.length > 0) {
        await prisma.notification.createMany({
          data: accountants.map((acc) => ({
            userId: acc.id,
            title: 'Новая сделка на проверку',
            body: `Сделка "${deal.title}" ожидает финансовой проверки`,
            severity: 'WARNING' as const,
            link: `/deals/${dealId}`,
            createdByUserId: user.userId,
          })),
        });

        // Fire-and-forget push
        pushService.sendPushToRoles(['ACCOUNTANT'], {
          title: 'Новая сделка на проверку',
          body: `Сделка "${deal.title}" ожидает финансовой проверки`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
        telegramService.sendToRoles(['ACCOUNTANT'], {
          title: 'Новая сделка на проверку',
          body: `Сделка "${deal.title}" ожидает финансовой проверки`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
      }
    }

    // Notify admins when deal goes directly to ADMIN_APPROVED (cash payments)
    if (targetStatus === 'ADMIN_APPROVED') {
      const admins = await prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
        select: { id: true },
      });

      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            title: 'Сделка ожидает проверки',
            body: `Сделка "${deal.title}" ожидает вашего одобрения`,
            severity: 'WARNING' as const,
            link: `/deals/${dealId}`,
            createdByUserId: user.userId,
          })),
        });

        pushService.sendPushToRoles(['ADMIN', 'SUPER_ADMIN'], {
          title: 'Сделка ожидает проверки',
          body: `Сделка "${deal.title}" ожидает вашего одобрения`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
        telegramService.sendToRoles(['ADMIN', 'SUPER_ADMIN'], {
          title: 'Сделка ожидает проверки',
          body: `Сделка "${deal.title}" ожидает вашего одобрения`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
      }
    }

    return this.findById(dealId, user);
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

    if (deal.status !== 'IN_PROGRESS' && deal.status !== 'STOCK_CONFIRMED' && deal.status !== 'WAITING_FINANCE') {
      throw new AppError(400, 'Сделка должна быть в статусе "В работе" для установки количеств');
    }

    // Verify user is manager of this deal or admin
    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
    const canFinanceEdit = user.role === 'ACCOUNTANT' && deal.status === 'WAITING_FINANCE';
    const canManagerEdit = deal.managerId === user.userId && deal.status !== 'WAITING_FINANCE';
    if (!isAdmin && !canFinanceEdit && !canManagerEdit) {
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
    if ((dto.paymentType === 'PARTIAL' || dto.paymentType === 'INSTALLMENT') && !dto.dueDate) {
      throw new AppError(400, 'Укажите срок оплаты для частичной оплаты или рассрочки');
    }

    // Auto-compute paymentStatus
    let paymentStatus: PrismaPaymentStatus = 'UNPAID';
    if (paidAmount >= finalAmount && finalAmount > 0) {
      paymentStatus = 'PAID';
    } else if (paidAmount > 0) {
      paymentStatus = 'PARTIAL';
    }

    // Move to IN_PROGRESS if currently STOCK_CONFIRMED
    const newStatus: DealStatus = deal.status === 'STOCK_CONFIRMED' ? 'IN_PROGRESS' : deal.status;

    await prisma.$transaction(async (tx) => {
      // Update each DealItem with requestedQty and price
      for (const item of dto.items) {
        await tx.dealItem.update({
          where: { id: item.dealItemId },
          data: {
            requestedQty: item.requestedQty,
            price: item.price,
            lineTotal: item.requestedQty * item.price,
          },
        });
      }

      // Update deal with calculated amounts and payment info
      await tx.deal.update({
        where: { id: dealId },
        data: {
          status: newStatus,
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
      before: { amount: Number(deal.amount), paidAmount: Number(deal.paidAmount), status: deal.status },
      after: { amount: finalAmount, paidAmount, paymentStatus, discount, status: newStatus },
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

    // Accept from WAITING_FINANCE (new flow) or legacy statuses
    if (deal.status !== 'WAITING_FINANCE' && deal.status !== 'IN_PROGRESS' && deal.status !== 'STOCK_CONFIRMED') {
      throw new AppError(400, 'Сделка должна быть в статусе "Ожидает финансы" для финансового одобрения');
    }

    // For WAITING_FINANCE → go to ADMIN_APPROVED (finance approved, now needs admin)
    const targetStatus: DealStatus = 'ADMIN_APPROVED';

    // QR/INSTALLMENT deals require a contract
    if (requiresContract(deal.paymentMethod) && !deal.contractId) {
      throw new AppError(400, 'Для QR/перечисления необходимо привязать договор к сделке');
    }

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: targetStatus },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: targetStatus },
    });

    // Notify deal manager about finance approval
    await prisma.notification.create({
      data: {
        userId: deal.managerId,
        title: 'Сделка одобрена бухгалтером',
        body: `Сделка "${deal.title}" прошла финансовую проверку`,
        severity: 'INFO',
        link: `/deals/${dealId}`,
        createdByUserId: user.userId,
      },
    });

    pushService.sendPushToUser(deal.managerId, {
      title: 'Сделка одобрена бухгалтером',
      body: `Сделка "${deal.title}" прошла финансовую проверку`,
      url: `/deals/${dealId}`,
      severity: 'INFO',
    }).catch(() => {});
    telegramService.sendToUser(deal.managerId, {
      title: 'Сделка одобрена бухгалтером',
      body: `Сделка "${deal.title}" прошла финансовую проверку`,
      url: `/deals/${dealId}`,
      severity: 'INFO',
    }).catch(() => {});

    // Notify admins that deal needs their approval after finance review
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
      select: { id: true },
    });

    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          title: 'Сделка прошла финансовую проверку',
          body: `Сделка "${deal.title}" одобрена бухгалтером — ожидает вашего одобрения`,
          severity: 'WARNING' as const,
          link: `/deals/${dealId}`,
          createdByUserId: user.userId,
        })),
      });

      pushService.sendPushToRoles(['ADMIN', 'SUPER_ADMIN'], {
        title: 'Сделка прошла финансовую проверку',
        body: `Сделка "${deal.title}" одобрена бухгалтером — ожидает вашего одобрения`,
        url: `/deals/${dealId}`,
        severity: 'WARNING',
      }).catch(() => {});
      telegramService.sendToRoles(['ADMIN', 'SUPER_ADMIN'], {
        title: 'Сделка прошла финансовую проверку',
        body: `Сделка "${deal.title}" одобрена бухгалтером — ожидает вашего одобрения`,
        url: `/deals/${dealId}`,
        severity: 'WARNING',
      }).catch(() => {});
    }

    return this.findById(dealId, user);
  }

  async rejectFinance(dealId: string, dto: FinanceRejectDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user), isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'WAITING_FINANCE' && deal.status !== 'IN_PROGRESS' && deal.status !== 'STOCK_CONFIRMED') {
      throw new AppError(400, 'Сделка должна быть в статусе "Ожидает финансы" для отклонения');
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

    // Notify deal manager about finance rejection (URGENT)
    await prisma.notification.create({
      data: {
        userId: deal.managerId,
        title: 'Сделка отклонена бухгалтером',
        body: `Сделка "${deal.title}" отклонена: ${dto.reason}`,
        severity: 'URGENT',
        link: `/deals/${dealId}`,
        createdByUserId: user.userId,
      },
    });

    pushService.sendPushToUser(deal.managerId, {
      title: 'Сделка отклонена бухгалтером',
      body: `Сделка "${deal.title}" отклонена: ${dto.reason}`,
      url: `/deals/${dealId}`,
      severity: 'URGENT',
    }).catch(() => {});
    telegramService.sendToUser(deal.managerId, {
      title: 'Сделка отклонена бухгалтером',
      body: `Сделка "${deal.title}" отклонена: ${dto.reason}`,
      url: `/deals/${dealId}`,
      severity: 'URGENT',
    }).catch(() => {});

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

    // Accept from ADMIN_APPROVED (already at admin step from finance or direct)
    // or from FINANCE_APPROVED (legacy), or from WAITING_FINANCE if admin
    if (deal.status !== 'ADMIN_APPROVED' && deal.status !== 'FINANCE_APPROVED' && deal.status !== 'WAITING_FINANCE') {
      throw new AppError(400, 'Сделка не готова для одобрения администратором');
    }

    // Contract check for QR/TRANSFER/INSTALLMENT
    if (requiresContract(deal.paymentMethod) && !deal.contractId) {
      throw new AppError(400, 'Для QR/перечисления/рассрочки необходимо привязать договор к сделке');
    }

    // For deals already at ADMIN_APPROVED, move to READY_FOR_SHIPMENT
    const targetStatus: DealStatus = 'READY_FOR_SHIPMENT';

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: targetStatus },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: targetStatus },
    });

    return this.findById(dealId, user);
  }

  // ==================== WORKFLOW QUEUES ====================

  async findForFinanceReview(user: AuthUser) {
    const deals = await prisma.deal.findMany({
      where: {
        status: 'WAITING_FINANCE',
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
    const debtAgg = clientIds.length > 0 ? await prisma.deal.groupBy({
      by: ['clientId'],
      where: {
        clientId: { in: clientIds },
        status: { notIn: ['CANCELED', 'REJECTED', 'CLOSED'] },
        isArchived: false,
      },
      _sum: { amount: true, paidAmount: true },
    }) : [];

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

  async findShipments(user: AuthUser, options: { page: number; limit: number }) {
    const { page, limit } = options;
    const skip = (page - 1) * limit;

    // Find deals with shipment records (delivered deals)
    const where = {
      isArchived: false,
      shipment: { isNot: null },
    };

    const [shipments, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true } },
          manager: { select: { id: true, fullName: true } },
          shipment: {
            include: {
              user: { select: { id: true, fullName: true } },
            },
          },
          items: {
            include: {
              product: { select: { name: true, sku: true } },
            },
          },
        },
        orderBy: [{ shipment: { shippedAt: 'desc' } }],
        skip,
        take: limit,
      }),
      prisma.deal.count({ where }),
    ]);

    return {
      data: shipments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getAllDealsWithShipmentInfo(user: AuthUser, options: { page: number; limit: number }) {
    const { page, limit } = options;
    const skip = (page - 1) * limit;

    // Find ALL deals (for debugging) to see what's in the database
    const where = {
      isArchived: false,
      // Don't filter by shipment - get all deals to see the data structure
    };

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true } },
          manager: { select: { id: true, fullName: true } },
          shipment: {
            include: {
              user: { select: { id: true, fullName: true } },
            },
          },
          items: {
            include: {
              product: { select: { name: true, sku: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.deal.count({ where }),
    ]);

    return {
      data: deals,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      debug: {
        totalDeals: total,
        dealsWithShipment: deals.filter(d => d.shipment !== null).length,
        message: 'This endpoint shows all deals for debugging purposes'
      },
    };
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
      throw new AppError(400, 'Сделка должна быть в статусе "Отгрузка" для приостановки');
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
      throw new AppError(400, 'Сделка должна быть в статусе "Отгрузка" для оформления');
    }

    // After shipment, deal goes directly to CLOSED
    const targetStatus: DealStatus = 'CLOSED';

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

      // Update deal status to CLOSED
      await tx.deal.update({
        where: { id: dealId },
        data: { status: targetStatus },
      });
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: {
        status: targetStatus,
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

  // ==================== DEAL APPROVAL (Admin approves/rejects after shipment) ====================

  async findForDealApproval(user: AuthUser) {
    return prisma.deal.findMany({
      where: {
        status: 'ADMIN_APPROVED',
        isArchived: false,
      },
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        shipment: {
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async approveDeal(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'ADMIN_APPROVED') {
      throw new AppError(400, 'Сделка должна быть в статусе "Ожидает потв. Админа"');
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

    await prisma.notification.create({
      data: {
        userId: deal.managerId,
        title: 'Сделка одобрена',
        body: `Сделка "${deal.title}" одобрена и готова к отгрузке`,
        severity: 'INFO',
        link: `/deals/${dealId}`,
        createdByUserId: user.userId,
      },
    });

    pushService.sendPushToUser(deal.managerId, {
      title: 'Сделка одобрена',
      body: `Сделка "${deal.title}" одобрена и готова к отгрузке`,
      url: `/deals/${dealId}`,
      severity: 'INFO',
    }).catch(() => {});
    telegramService.sendToUser(deal.managerId, {
      title: 'Сделка одобрена',
      body: `Сделка "${deal.title}" одобрена и готова к отгрузке`,
      url: `/deals/${dealId}`,
      severity: 'INFO',
    }).catch(() => {});

    // Notify warehouse managers that deal is ready for shipment
    const warehouseManagers = await prisma.user.findMany({
      where: { role: { in: ['WAREHOUSE_MANAGER'] }, isActive: true },
      select: { id: true },
    });

    if (warehouseManagers.length > 0) {
      await prisma.notification.createMany({
        data: warehouseManagers.map((wm) => ({
          userId: wm.id,
          title: 'Новая сделка на отгрузку',
          body: `Сделка "${deal.title}" одобрена и готова к отгрузке`,
          severity: 'WARNING' as const,
          link: `/deals/${dealId}`,
          createdByUserId: user.userId,
        })),
      });

      pushService.sendPushToRoles(['WAREHOUSE_MANAGER'], {
        title: 'Новая сделка на отгрузку',
        body: `Сделка "${deal.title}" одобрена и готова к отгрузке`,
        url: `/deals/${dealId}`,
        severity: 'WARNING',
      }).catch(() => {});
      telegramService.sendToRoles(['WAREHOUSE_MANAGER'], {
        title: 'Новая сделка на отгрузку',
        body: `Сделка "${deal.title}" одобрена и готова к отгрузке`,
        url: `/deals/${dealId}`,
        severity: 'WARNING',
      }).catch(() => {});
    }

    // Notify accountants about admin approval
    const accountants = await prisma.user.findMany({
      where: { role: 'ACCOUNTANT', isActive: true },
      select: { id: true },
    });

    if (accountants.length > 0) {
      await prisma.notification.createMany({
        data: accountants.map((acc) => ({
          userId: acc.id,
          title: 'Сделка одобрена админом',
          body: `Сделка "${deal.title}" одобрена и передана на отгрузку`,
          severity: 'INFO' as const,
          link: `/deals/${dealId}`,
          createdByUserId: user.userId,
        })),
      });

      pushService.sendPushToRoles(['ACCOUNTANT'], {
        title: 'Сделка одобрена админом',
        body: `Сделка "${deal.title}" одобрена и передана на отгрузку`,
        url: `/deals/${dealId}`,
        severity: 'INFO',
      }).catch(() => {});
      telegramService.sendToRoles(['ACCOUNTANT'], {
        title: 'Сделка одобрена админом',
        body: `Сделка "${deal.title}" одобрена и передана на отгрузку`,
        url: `/deals/${dealId}`,
        severity: 'INFO',
      }).catch(() => {});
    }

    return this.findById(dealId, user);
  }

  async rejectDeal(dealId: string, reason: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, isArchived: false },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'ADMIN_APPROVED') {
      throw new AppError(400, 'Сделка должна быть в статусе "Ожидает потв. Админа"');
    }

    validateStatusTransition(deal.status, 'IN_PROGRESS', user.role);

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: 'IN_PROGRESS' },
    });

    await prisma.dealComment.create({
      data: {
        dealId,
        authorId: user.userId,
        text: `Отклонено администратором: ${reason}`,
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'IN_PROGRESS', reason },
    });

    await prisma.notification.create({
      data: {
        userId: deal.managerId,
        title: 'Сделка отклонена',
        body: `Сделка "${deal.title}" отклонена: ${reason}`,
        severity: 'URGENT',
        link: `/deals/${dealId}`,
        createdByUserId: user.userId,
      },
    });

    pushService.sendPushToUser(deal.managerId, {
      title: 'Сделка отклонена',
      body: `Сделка "${deal.title}" отклонена: ${reason}`,
      url: `/deals/${dealId}`,
      severity: 'URGENT',
    }).catch(() => {});
    telegramService.sendToUser(deal.managerId, {
      title: 'Сделка отклонена',
      body: `Сделка "${deal.title}" отклонена: ${reason}`,
      url: `/deals/${dealId}`,
      severity: 'URGENT',
    }).catch(() => {});

    // Notify accountants about admin rejection
    const accountants = await prisma.user.findMany({
      where: { role: 'ACCOUNTANT', isActive: true },
      select: { id: true },
    });

    if (accountants.length > 0) {
      await prisma.notification.createMany({
        data: accountants.map((acc) => ({
          userId: acc.id,
          title: 'Сделка отклонена админом',
          body: `Сделка "${deal.title}" отклонена: ${reason}`,
          severity: 'WARNING' as const,
          link: `/deals/${dealId}`,
          createdByUserId: user.userId,
        })),
      });

      pushService.sendPushToRoles(['ACCOUNTANT'], {
        title: 'Сделка отклонена админом',
        body: `Сделка "${deal.title}" отклонена: ${reason}`,
        url: `/deals/${dealId}`,
        severity: 'WARNING',
      }).catch(() => {});
      telegramService.sendToRoles(['ACCOUNTANT'], {
        title: 'Сделка отклонена админом',
        body: `Сделка "${deal.title}" отклонена: ${reason}`,
        url: `/deals/${dealId}`,
        severity: 'WARNING',
      }).catch(() => {});
    }

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
      version: { increment: 1 },
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

    // Optimistic locking: update only if version matches
    const result = await prisma.deal.updateMany({
      where: { id, version: deal.version },
      data,
    });

    if (result.count === 0) {
      throw new AppError(409, 'Данные сделки были изменены другим пользователем. Обновите страницу.');
    }

    const updated = await prisma.deal.findUnique({
      where: { id },
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
        paidAmount: Number(updated!.paidAmount),
        paymentType: updated!.paymentType,
        paymentStatus: updated!.paymentStatus,
        dueDate: updated!.dueDate,
        terms: updated!.terms,
      },
    });

    return updated;
  }

  // ==================== PAYMENT RECORDS ====================

  async createPaymentRecord(dealId: string, dto: CreatePaymentRecordDto, user: AuthUser) {
    // All reads and writes inside one transaction with optimistic locking
    const payment = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.findFirst({
        where: { id: dealId, ...ownerScope(user), isArchived: false },
      });

      if (!deal) {
        throw new AppError(404, 'Сделка не найдена');
      }

      // Оплата доступна только с момента отгрузки
      const allowedForPayment: DealStatus[] = ['IN_PROGRESS', 'WAITING_FINANCE', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT', 'SHIPMENT_ON_HOLD', 'REOPENED', 'CLOSED'];
      if (!allowedForPayment.includes(deal.status)) {
        throw new AppError(400, 'Оплата доступна только со статуса "В работе" и далее');
      }

      const amount = Number(deal.amount);
      const currentPaid = Number(deal.paidAmount);
      const newTotal = currentPaid + dto.amount;

      // Auto-compute paymentStatus
      let paymentStatus: PrismaPaymentStatus;
      if (newTotal === 0) {
        paymentStatus = 'UNPAID';
      } else if (newTotal >= amount) {
        paymentStatus = 'PAID';
      } else {
        paymentStatus = 'PARTIAL';
      }

      const paymentDate = dto.paidAt ? new Date(dto.paidAt) : new Date();
      if (paymentDate > new Date()) {
        throw new AppError(400, 'Дата оплаты не может быть в будущем');
      }

      const created = await tx.payment.create({
        data: {
          dealId,
          clientId: deal.clientId,
          amount: dto.amount,
          paidAt: paymentDate,
          method: dto.method,
          note: dto.note,
          createdBy: user.userId,
        },
        include: {
          creator: { select: { id: true, fullName: true } },
        },
      });

      // Optimistic locking: update deal only if version matches
      const updated = await tx.deal.updateMany({
        where: { id: dealId, version: deal.version },
        data: { paidAmount: newTotal, paymentStatus, version: { increment: 1 } },
      });

      if (updated.count === 0) {
        throw new AppError(409, 'Данные сделки были изменены другим пользователем. Обновите страницу.');
      }

      return { created, newTotal, paymentStatus };
    });

    await auditLog({
      userId: user.userId,
      action: 'PAYMENT_CREATE',
      entityType: 'deal',
      entityId: dealId,
      after: {
        paymentId: payment.created.id,
        amount: dto.amount,
        newPaidAmount: payment.newTotal,
        paymentStatus: payment.paymentStatus,
      },
    });

    return payment.created;
  }

  async updatePaymentRecord(dealId: string, paymentId: string, dto: UpdatePaymentRecordDto, user: AuthUser) {
    const result = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.findFirst({
        where: { id: dealId, ...ownerScope(user), isArchived: false },
      });
      if (!deal) throw new AppError(404, 'Сделка не найдена');

      const payment = await tx.payment.findFirst({ where: { id: paymentId, dealId } });
      if (!payment) throw new AppError(404, 'Платёж не найден');

      const oldAmount = Number(payment.amount);
      const newAmount = dto.amount ?? oldAmount;
      const diff = newAmount - oldAmount;
      const newTotal = Number(deal.paidAmount) + diff;

      if (dto.paidAt) {
        const paymentDate = new Date(dto.paidAt);
        if (paymentDate > new Date()) throw new AppError(400, 'Дата оплаты не может быть в будущем');
      }

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.method !== undefined && { method: dto.method }),
          ...(dto.note !== undefined && { note: dto.note }),
          ...(dto.paidAt && { paidAt: new Date(dto.paidAt) }),
        },
        include: { creator: { select: { id: true, fullName: true } } },
      });

      let paymentStatus: PrismaPaymentStatus;
      const dealAmount = Number(deal.amount);
      if (newTotal === 0) paymentStatus = 'UNPAID';
      else if (newTotal >= dealAmount) paymentStatus = 'PAID';
      else paymentStatus = 'PARTIAL';

      const dealUpdated = await tx.deal.updateMany({
        where: { id: dealId, version: deal.version },
        data: { paidAmount: newTotal, paymentStatus, version: { increment: 1 } },
      });
      if (dealUpdated.count === 0) throw new AppError(409, 'Данные сделки были изменены. Обновите страницу.');

      return updated;
    });

    await auditLog({
      userId: user.userId, action: 'PAYMENT_UPDATE', entityType: 'deal', entityId: dealId,
      after: { paymentId, ...dto },
    });

    return result;
  }

  async deletePaymentRecord(dealId: string, paymentId: string, user: AuthUser) {
    const result = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.findFirst({
        where: { id: dealId, ...ownerScope(user), isArchived: false },
      });
      if (!deal) throw new AppError(404, 'Сделка не найдена');

      const payment = await tx.payment.findFirst({ where: { id: paymentId, dealId } });
      if (!payment) throw new AppError(404, 'Платёж не найден');

      const removedAmount = Number(payment.amount);
      const newTotal = Number(deal.paidAmount) - removedAmount;

      await tx.payment.delete({ where: { id: paymentId } });

      let paymentStatus: PrismaPaymentStatus;
      const dealAmount = Number(deal.amount);
      if (newTotal <= 0) paymentStatus = 'UNPAID';
      else if (newTotal >= dealAmount) paymentStatus = 'PAID';
      else paymentStatus = 'PARTIAL';

      const dealUpdated = await tx.deal.updateMany({
        where: { id: dealId, version: deal.version },
        data: { paidAmount: Math.max(0, newTotal), paymentStatus, version: { increment: 1 } },
      });
      if (dealUpdated.count === 0) throw new AppError(409, 'Данные сделки были изменены. Обновите страницу.');

      return { removedAmount, newTotal: Math.max(0, newTotal), paymentStatus };
    });

    await auditLog({
      userId: user.userId, action: 'PAYMENT_DELETE', entityType: 'deal', entityId: dealId,
      after: { paymentId, removedAmount: result.removedAmount },
    });

    return result;
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

    if (deal.isArchived) {
      throw new AppError(400, 'Сделка уже в архиве');
    }

    const updated = await prisma.deal.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date(), archivedById: user.userId },
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

  async unarchive(id: string, user: AuthUser) {
    const canArchive = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
    if (!canArchive) {
      throw new AppError(403, 'Только ADMIN и SUPER_ADMIN могут разархивировать сделки');
    }

    const deal = await prisma.deal.findUnique({ where: { id } });
    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (!deal.isArchived) {
      throw new AppError(400, 'Сделка не архивирована');
    }

    const updated = await prisma.deal.update({
      where: { id },
      data: { isArchived: false, archivedAt: null, archivedById: null },
    });

    await auditLog({
      userId: user.userId,
      action: 'RESTORE',
      entityType: 'deal',
      entityId: id,
      before: { isArchived: true },
      after: { isArchived: false },
    });

    return updated;
  }

  async findArchived(user: AuthUser) {
    return prisma.deal.findMany({
      where: {
        ...ownerScope(user),
        isArchived: true,
      },
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        archivedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { archivedAt: 'desc' },
    });
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

  // ==================== SUPER_ADMIN OVERRIDE ====================

  async overrideUpdate(id: string, dto: SuperOverrideDealDto, user: AuthUser) {
    const deal = await prisma.deal.findUnique({
      where: { id },
      include: {
        items: true,
        shipment: true,
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
      },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    // Build complete "before" snapshot
    const beforeSnapshot: Record<string, unknown> = {
      title: deal.title,
      status: deal.status,
      amount: Number(deal.amount),
      discount: Number(deal.discount),
      clientId: deal.clientId,
      managerId: deal.managerId,
      contractId: deal.contractId,
      paymentMethod: deal.paymentMethod,
      paymentType: deal.paymentType,
      paidAmount: Number(deal.paidAmount),
      paymentStatus: deal.paymentStatus,
      dueDate: deal.dueDate,
      terms: deal.terms,
      items: deal.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        requestedQty: i.requestedQty != null ? Number(i.requestedQty) : null,
        price: i.price != null ? Number(i.price) : null,
      })),
      shipment: deal.shipment ? {
        vehicleType: deal.shipment.vehicleType,
        vehicleNumber: deal.shipment.vehicleNumber,
        driverName: deal.shipment.driverName,
        deliveryNoteNumber: deal.shipment.deliveryNoteNumber,
      } : null,
    };

    await prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};

      if (dto.title !== undefined) data.title = dto.title;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.discount !== undefined) data.discount = dto.discount;
      if (dto.terms !== undefined) data.terms = dto.terms;
      if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
      if (dto.paymentType !== undefined) data.paymentType = dto.paymentType;
      if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
      if (dto.paidAmount !== undefined) data.paidAmount = dto.paidAmount;

      if (dto.clientId !== undefined && dto.clientId !== deal.clientId) {
        const client = await tx.client.findUnique({ where: { id: dto.clientId } });
        if (!client) throw new AppError(404, 'Клиент не найден');
        data.clientId = dto.clientId;
      }

      if (dto.managerId !== undefined && dto.managerId !== deal.managerId) {
        const manager = await tx.user.findUnique({ where: { id: dto.managerId } });
        if (!manager || !manager.isActive) throw new AppError(404, 'Менеджер не найден или неактивен');
        data.managerId = dto.managerId;
      }

      if (dto.contractId !== undefined) {
        if (dto.contractId !== null) {
          const contract = await tx.contract.findUnique({ where: { id: dto.contractId } });
          if (!contract) throw new AppError(404, 'Договор не найден');
        }
        data.contractId = dto.contractId;
      }

      // Items full replacement
      if (dto.items !== undefined) {
        // Check if deal has been shipped (has OUT movements) — adjust stock accordingly
        const existingMovements = await tx.inventoryMovement.findMany({
          where: { dealId: id, type: 'OUT' },
        });

        if (existingMovements.length > 0) {
          // Build map of how much was shipped per product
          const shippedQtyMap = new Map<string, number>();
          for (const mov of existingMovements) {
            const prev = shippedQtyMap.get(mov.productId) ?? 0;
            shippedQtyMap.set(mov.productId, prev + Number(mov.quantity));
          }

          // Build map of new quantities per product
          const newQtyMap = new Map<string, number>();
          for (const item of dto.items) {
            const prev = newQtyMap.get(item.productId) ?? 0;
            newQtyMap.set(item.productId, prev + (item.requestedQty ?? 0));
          }

          // Process all products that were shipped
          const allProductIds = new Set([...shippedQtyMap.keys(), ...newQtyMap.keys()]);
          for (const productId of allProductIds) {
            const shipped = shippedQtyMap.get(productId) ?? 0;
            const newQty = newQtyMap.get(productId) ?? 0;
            const diff = shipped - newQty;

            if (diff > 0) {
              // Quantity decreased — return to stock
              await tx.product.update({
                where: { id: productId },
                data: { stock: { increment: diff } },
              });
              await tx.inventoryMovement.create({
                data: {
                  productId,
                  type: 'IN',
                  quantity: diff,
                  dealId: id,
                  note: `Возврат на склад: коррекция при изменении сделки (супер-оверрайд)`,
                  createdBy: user.userId,
                },
              });
            } else if (diff < 0) {
              // Quantity increased — deduct from stock
              const absDiff = Math.abs(diff);
              const result = await tx.product.updateMany({
                where: { id: productId, stock: { gte: absDiff } },
                data: { stock: { decrement: absDiff } },
              });
              if (result.count === 0) {
                const product = await tx.product.findUnique({ where: { id: productId } });
                throw new AppError(400,
                  `Недостаточно товара "${product?.name}" на складе для увеличения количества`,
                );
              }
              await tx.inventoryMovement.create({
                data: {
                  productId,
                  type: 'OUT',
                  quantity: absDiff,
                  dealId: id,
                  note: `Доп. списание: коррекция при изменении сделки (супер-оверрайд)`,
                  createdBy: user.userId,
                },
              });
            }
          }
        }

        await tx.dealItem.deleteMany({ where: { dealId: id } });
        for (const item of dto.items) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product) throw new AppError(404, `Товар ${item.productId} не найден`);
          await tx.dealItem.create({
            data: {
              dealId: id,
              productId: item.productId,
              requestedQty: item.requestedQty ?? null,
              price: item.price ?? null,
              requestComment: item.requestComment,
              warehouseComment: item.warehouseComment,
            },
          });
        }
      }

      // Shipment upsert
      if (dto.shipment !== undefined) {
        await tx.shipment.upsert({
          where: { dealId: id },
          update: {
            vehicleType: dto.shipment.vehicleType,
            vehicleNumber: dto.shipment.vehicleNumber,
            driverName: dto.shipment.driverName,
            departureTime: new Date(dto.shipment.departureTime),
            deliveryNoteNumber: dto.shipment.deliveryNoteNumber,
            shipmentComment: dto.shipment.shipmentComment,
          },
          create: {
            dealId: id,
            vehicleType: dto.shipment.vehicleType,
            vehicleNumber: dto.shipment.vehicleNumber,
            driverName: dto.shipment.driverName,
            departureTime: new Date(dto.shipment.departureTime),
            deliveryNoteNumber: dto.shipment.deliveryNoteNumber,
            shipmentComment: dto.shipment.shipmentComment,
            shippedBy: user.userId,
          },
        });
      }

      if (Object.keys(data).length > 0) {
        await tx.deal.update({ where: { id }, data });
      }
    });

    // Recalculate amount if items or discount changed
    if (dto.items !== undefined || dto.discount !== undefined) {
      await this.recalcAmount(id);
    }

    // Recompute paymentStatus
    if (dto.paidAmount !== undefined || dto.items !== undefined) {
      const freshDeal = await prisma.deal.findUnique({ where: { id } });
      if (freshDeal) {
        const amount = Number(freshDeal.amount);
        const paid = Number(freshDeal.paidAmount);
        let paymentStatus: PrismaPaymentStatus = 'UNPAID';
        if (paid >= amount && amount > 0) paymentStatus = 'PAID';
        else if (paid > 0) paymentStatus = 'PARTIAL';
        await prisma.deal.update({ where: { id }, data: { paymentStatus } });
      }
    }

    // Build "after" snapshot
    const updatedDeal = await prisma.deal.findUnique({
      where: { id },
      include: { items: true, shipment: true },
    });

    const afterSnapshot: Record<string, unknown> = {
      title: updatedDeal!.title,
      status: updatedDeal!.status,
      amount: Number(updatedDeal!.amount),
      discount: Number(updatedDeal!.discount),
      clientId: updatedDeal!.clientId,
      managerId: updatedDeal!.managerId,
      contractId: updatedDeal!.contractId,
      paymentMethod: updatedDeal!.paymentMethod,
      paymentType: updatedDeal!.paymentType,
      paidAmount: Number(updatedDeal!.paidAmount),
      paymentStatus: updatedDeal!.paymentStatus,
      items: updatedDeal!.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        requestedQty: i.requestedQty != null ? Number(i.requestedQty) : null,
        price: i.price != null ? Number(i.price) : null,
      })),
      shipment: updatedDeal!.shipment ? {
        vehicleType: updatedDeal!.shipment.vehicleType,
        vehicleNumber: updatedDeal!.shipment.vehicleNumber,
        driverName: updatedDeal!.shipment.driverName,
        deliveryNoteNumber: updatedDeal!.shipment.deliveryNoteNumber,
      } : null,
    };

    await auditLog({
      userId: user.userId,
      action: 'OVERRIDE_UPDATE',
      entityType: 'deal',
      entityId: id,
      before: beforeSnapshot,
      after: afterSnapshot,
      reason: dto.reason,
    });

    return this.findById(id, user);
  }

  async hardDelete(id: string, reason: string, user: AuthUser) {
    const deal = await prisma.deal.findUnique({
      where: { id },
      include: {
        items: true,
        shipment: true,
        comments: true,
        payments: true,
        movements: true,
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, fullName: true } },
      },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    const snapshot: Record<string, unknown> = {
      id: deal.id,
      title: deal.title,
      status: deal.status,
      amount: Number(deal.amount),
      clientId: deal.clientId,
      clientName: deal.client?.companyName,
      managerId: deal.managerId,
      managerName: deal.manager?.fullName,
      itemsCount: deal.items.length,
      commentsCount: deal.comments.length,
      paymentsCount: deal.payments.length,
      movementsCount: deal.movements.length,
      totalPaid: Number(deal.paidAmount),
      createdAt: deal.createdAt,
    };

    await prisma.$transaction(async (tx) => {
      // Reverse inventory movements: keep history, unlink from deal, create reverse entries
      if (deal.movements.length > 0) {
        const dealLabel = deal.title || id.slice(0, 8);
        for (const mov of deal.movements) {
          if (mov.type === 'OUT') {
            // Return stock to warehouse
            await tx.product.update({
              where: { id: mov.productId },
              data: { stock: { increment: Number(mov.quantity) } },
            });
            // Create reverse IN movement for audit trail
            await tx.inventoryMovement.create({
              data: {
                productId: mov.productId,
                type: 'IN',
                quantity: Number(mov.quantity),
                dealId: null,
                note: `Возврат на склад: сделка "${dealLabel}" удалена`,
                createdBy: user.userId,
              },
            });
          } else if (mov.type === 'IN') {
            // Reverse previous returns
            await tx.product.update({
              where: { id: mov.productId },
              data: { stock: { decrement: Number(mov.quantity) } },
            });
          }
        }
        // Unlink original movements from deal (keep history)
        await tx.inventoryMovement.updateMany({
          where: { dealId: id },
          data: { dealId: null, note: `[Сделка "${dealLabel}" удалена] ` },
        });
      }

      await tx.message.updateMany({ where: { dealId: id }, data: { dealId: null } });
      await tx.payment.deleteMany({ where: { dealId: id } });
      await tx.deal.delete({ where: { id } });
    });

    await auditLog({
      userId: user.userId,
      action: 'OVERRIDE_DELETE',
      entityType: 'deal',
      entityId: id,
      before: snapshot,
      after: null,
      reason,
    });

    return { success: true, deletedDealId: id };
  }

  async getAuditHistory(dealId: string) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    return prisma.auditLog.findMany({
      where: { entityType: 'deal', entityId: dealId },
      include: { user: { select: { id: true, fullName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const dealsService = new DealsService();
