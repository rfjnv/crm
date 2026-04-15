import { DealStatus, PaymentStatus as PrismaPaymentStatus, PaymentMethod, Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import crypto from 'crypto';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser, ownerScope } from '../../lib/scope';
import { PERMISSIONS } from '../../lib/permissions';
import {
  currentTashkentYmd,
  parseClosedDateFromDealTitle,
  resolveClosedAtForNewClose,
  tashkentDayBoundsFromYmd,
} from '../../lib/dealClosedAt';
import { pushService } from '../push/push.service';
import { telegramService } from '../telegram/telegram.service';
import {
  onDealCreated,
  onDealStatusChanged,
  trySendFinanceTelegram,
  trySendProductionTelegram,
  sendProductionPaymentSubmitTelegram,
  trySendAdminApprovalTelegram,
  appendFinanceTelegramLog,
  syncDealTelegramGroupMessages,
  cleanupStockWaitTelegramMessages,
} from '../telegram/telegram-deal-groups.service';
import {
  CreateDealDto, UpdateDealDto, CreateCommentDto, PaymentDto,
  AddDealItemDto, WarehouseResponseDto, SetItemQuantitiesDto,
  ShipmentDto, FinanceRejectDto, SendToFinanceDto,
  CreatePaymentRecordDto, UpdatePaymentRecordDto, ShipmentHoldDto,
  SuperOverrideDealDto,
  AssignLoadingDto, AssignDriverDto, StartDeliveryDto,
} from './deals.dto';

// ==================== STATUS WORKFLOW ====================

const STATUS_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  NEW: ['WAITING_STOCK_CONFIRMATION', 'CANCELED'],
  WAITING_STOCK_CONFIRMATION: ['STOCK_CONFIRMED', 'NEW', 'CANCELED'],
  STOCK_CONFIRMED: ['IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'CANCELED'],
  IN_PROGRESS: ['WAITING_FINANCE', 'WAITING_WAREHOUSE_MANAGER', 'WAITING_STOCK_CONFIRMATION', 'REJECTED', 'CANCELED'],
  WAITING_FINANCE: ['WAITING_WAREHOUSE_MANAGER', 'IN_PROGRESS', 'REJECTED', 'CANCELED'],
  FINANCE_APPROVED: ['WAITING_WAREHOUSE_MANAGER', 'CANCELED'],
  // New workflow
  WAITING_WAREHOUSE_MANAGER: ['PENDING_ADMIN', 'CANCELED'],
  PENDING_ADMIN: ['READY_FOR_LOADING', 'REJECTED', 'CANCELED'],
  READY_FOR_LOADING: ['LOADING_ASSIGNED', 'CANCELED'],
  LOADING_ASSIGNED: ['CLOSED', 'READY_FOR_DELIVERY', 'CANCELED'],
  READY_FOR_DELIVERY: ['IN_DELIVERY', 'CANCELED'],
  IN_DELIVERY: ['CLOSED'],
  // Legacy (kept for backward compat)
  ADMIN_APPROVED: ['READY_FOR_LOADING', 'READY_FOR_SHIPMENT', 'IN_PROGRESS', 'CANCELED'],
  READY_FOR_SHIPMENT: ['CLOSED', 'SHIPMENT_ON_HOLD', 'CANCELED'],
  SHIPMENT_ON_HOLD: ['READY_FOR_SHIPMENT', 'CANCELED'],
  SHIPPED: [],
  PENDING_APPROVAL: [],
  CLOSED: [],
  CANCELED: [],
  REJECTED: ['IN_PROGRESS'],
  REOPENED: ['READY_FOR_SHIPMENT', 'CANCELED'],
};

const STATUS_ROLE_PERMISSIONS: Partial<Record<DealStatus, Role[]>> = {
  NEW: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  WAITING_STOCK_CONFIRMATION: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  STOCK_CONFIRMED: ['WAREHOUSE', 'WAREHOUSE_MANAGER', 'LOADER', 'ADMIN', 'SUPER_ADMIN'],
  IN_PROGRESS: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  WAITING_FINANCE: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  FINANCE_APPROVED: ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'],
  WAITING_WAREHOUSE_MANAGER: ['MANAGER', 'ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'],
  PENDING_ADMIN: ['WAREHOUSE_MANAGER', 'WAREHOUSE', 'LOADER', 'ADMIN', 'SUPER_ADMIN'],
  READY_FOR_LOADING: ['ADMIN', 'SUPER_ADMIN'],
  LOADING_ASSIGNED: ['WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  READY_FOR_DELIVERY: ['WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  IN_DELIVERY: ['WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  // Legacy
  ADMIN_APPROVED: ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT'],
  READY_FOR_SHIPMENT: ['ADMIN', 'SUPER_ADMIN'],
  SHIPMENT_ON_HOLD: ['WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  CLOSED: ['WAREHOUSE_MANAGER', 'WAREHOUSE', 'DRIVER', 'LOADER', 'ADMIN', 'SUPER_ADMIN'],
  CANCELED: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  REJECTED: ['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN'],
  REOPENED: ['ADMIN', 'SUPER_ADMIN'],
};

const FINANCE_REVIEW_METHODS: PaymentMethod[] = ['TRANSFER', 'INSTALLMENT'];
const CONTRACT_REQUIRED_METHODS: PaymentMethod[] = ['TRANSFER', 'INSTALLMENT'];

function normalizeTransferDocuments(documents?: string[]): string[] {
  if (!Array.isArray(documents)) return [];

  return Array.from(
    new Set(
      documents
        .filter((doc): doc is string => typeof doc === 'string')
        .map((doc) => doc.trim())
        .filter(Boolean),
    ),
  );
}

function requiresFinanceReview(method: PaymentMethod): boolean {
  return FINANCE_REVIEW_METHODS.includes(method);
}

/** Позиция ждёт количество от склада (менеджер не указал или указал ≤ 0). */
function dealItemNeedsStockQty(item: { requestedQty: unknown }): boolean {
  if (item.requestedQty == null) return true;
  const n = Number(item.requestedQty);
  return !Number.isFinite(n) || n <= 0;
}

const ROLES_CAN_ADD_REMOVE_DEAL_ITEMS: Role[] = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'];

/** Менеджер может добавлять/удалять позиции в любом статусе, кроме закрытой и отменённой сделки. */
function assertCanAddOrRemoveDealItem(
  deal: { status: DealStatus; isArchived: boolean },
  user: AuthUser,
): void {
  if (!ROLES_CAN_ADD_REMOVE_DEAL_ITEMS.includes(user.role)) {
    throw new AppError(403, 'Недостаточно прав для добавления или удаления товаров в сделке');
  }
  if (deal.isArchived) {
    throw new AppError(400, 'Нельзя изменять позиции архивной сделки');
  }
  if (deal.status === 'CLOSED' || deal.status === 'CANCELED') {
    throw new AppError(400, 'Нельзя добавлять или удалять товары: сделка закрыта или отменена');
  }
}

async function recalcDealAmountFromItemsInTx(tx: Prisma.TransactionClient, dealId: string): Promise<void> {
  const deal = await tx.deal.findUnique({
    where: { id: dealId },
    select: { discount: true, includeVat: true },
  });
  if (!deal) {
    throw new AppError(404, 'Сделка не найдена');
  }

  const items = await tx.dealItem.findMany({ where: { dealId } });
  let subtotal = 0;
  for (const i of items) {
    const q = i.requestedQty != null ? Number(i.requestedQty) : 0;
    const p = i.price != null ? Number(i.price) : 0;
    if (q > 0 && p > 0) {
      subtotal += q * p;
    }
  }

  const discount = Number(deal.discount) || 0;
  let finalAmount = subtotal - discount;
  if (!deal.includeVat) {
    finalAmount = Math.round((finalAmount / 1.12) * 100) / 100;
  }
  if (finalAmount < 0) {
    throw new AppError(400, 'Сумма сделки не может быть отрицательной');
  }

  await tx.deal.update({
    where: { id: dealId },
    data: { amount: finalAmount },
  });
}

function requiresContract(method: PaymentMethod | null): boolean {
  return !!method && CONTRACT_REQUIRED_METHODS.includes(method);
}

function isDilnozaIdentity(login?: string | null, fullName?: string | null): boolean {
  const l = (login || '').trim().toLowerCase();
  const f = (fullName || '').trim().toLowerCase();
  return l === 'dilnoza' || f === 'dilnoza' || f.includes('дилноза');
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

function parseOptionalDate(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  return value ? new Date(value) : null;
}

// ==================== SERVICE ====================

export class DealsService {
  /**
   * Списание товара при закрытии. Если уже есть OUT по сделке (накладная submitShipment) — не дублируем.
   */
  private async deductInventoryForDealInTx(
    tx: Prisma.TransactionClient,
    dealId: string,
    userId: string,
    movementNote = 'Автосписание при закрытии сделки',
  ) {
    const existing = await tx.inventoryMovement.findFirst({
      where: { dealId, type: 'OUT' },
    });
    if (existing) return;

    const dealItems = await tx.dealItem.findMany({
      where: { dealId },
      include: { product: true },
    });

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

      await tx.inventoryMovement.create({
        data: {
          productId: item.productId,
          type: 'OUT',
          quantity: qty,
          dealId,
          note: movementNote,
          createdBy: userId,
        },
      });
    }
  }

  /** Для CLOSED: после платежа подтягиваем closedAt к дате в названии (DD.MM.YYYY), чтобы не «плавала» из‑за updatedAt. */
  private async syncClosedAtFromTitleIfClosed(dealId: string) {
    const row = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { title: true, status: true },
    });
    if (row?.status !== 'CLOSED') return;
    const fromTitle = parseClosedDateFromDealTitle(row.title);
    if (!fromTitle) return;
    await prisma.deal.update({ where: { id: dealId }, data: { closedAt: fromTitle } });
  }

  async findAll(
    user: AuthUser,
    filters?: {
      status?: DealStatus;
      includeClosed?: boolean;
      paymentStatus?: PrismaPaymentStatus;
      managerId?: string;
      closedFrom?: Date;
      closedTo?: Date;
    },
  ) {
    if (filters?.status === 'CLOSED') {
      const allowed =
        user.role === 'SUPER_ADMIN'
        || user.role === 'ADMIN'
        || (user.permissions || []).includes(PERMISSIONS.VIEW_CLOSED_DEALS_HISTORY);
      if (!allowed) {
        throw new AppError(403, 'Недостаточно прав для просмотра истории закрытых сделок');
      }
    }

    const where: Prisma.DealWhereInput = {
      ...ownerScope(user),
      isArchived: false,
    };

    if (filters?.status) {
      where.status = filters.status;
    } else if (!filters?.includeClosed) {
      where.status = { notIn: ['CLOSED'] };
    }

    if (filters?.paymentStatus) {
      where.paymentStatus = filters.paymentStatus;
    }
    if (filters?.managerId) {
      where.managerId = filters.managerId;
    }

    if (filters?.closedFrom || filters?.closedTo) {
      const dt: Prisma.DateTimeFilter = {};
      if (filters.closedFrom) dt.gte = filters.closedFrom;
      if (filters.closedTo) dt.lte = filters.closedTo;
      // История CLOSED: только closedAt. updatedAt трогают платежи — иначе в «Сегодня» попадают лишние сделки.
      const dateClause: Prisma.DealWhereInput =
        filters.status === 'CLOSED'
          ? { closedAt: dt }
          : {
              OR: [{ closedAt: dt }, { AND: [{ closedAt: null }, { updatedAt: dt }] }],
            };
      const existingAnd = where.AND;
      where.AND = [
        ...(existingAnd === undefined ? [] : Array.isArray(existingAnd) ? existingAnd : [existingAnd]),
        dateClause,
      ];
    }

    return prisma.deal.findMany({
      where,
      include: {
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        _count: { select: { comments: true, items: true } },
      },
      orderBy:
        filters?.status === 'CLOSED'
          ? [{ closedAt: 'desc' }, { updatedAt: 'desc' }]
          : { createdAt: 'desc' },
    });
  }

  async findById(id: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id, ...ownerScope(user) },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, inn: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
        loadingAssignee: { select: { id: true, fullName: true } },
        deliveryDriver: { select: { id: true, fullName: true } },
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

    // Parse transfer documents if present
    const parsedDeal = this.parseTransferDocuments(deal);
    return parsedDeal;
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
    let initialStatus: DealStatus = allHaveQty ? 'IN_PROGRESS' : 'WAITING_STOCK_CONFIRMATION';
    /** Для Telegram onDealCreated: при явном маршруте Dilnoza подставляем флаг «все кол-ва есть». */
    let allHaveQtyForTelegram = allHaveQty;

    // Custom payment method at create is enabled only for Dilnoza.
    const creator = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { login: true, fullName: true },
    });
    const canUseDilnozaCreatePayment = isDilnozaIdentity(creator?.login, creator?.fullName);
    const paymentMethodAtCreate: PaymentMethod | null =
      canUseDilnozaCreatePayment && dto.paymentMethod ? (dto.paymentMethod as PaymentMethod) : null;

    let dilnozaTerms: string | null = null;
    let dilnozaTransferInn: string | null = null;
    let dilnozaTransferDocuments: string | null = null;
    let dilnozaTransferType: string | null = null;

    if (canUseDilnozaCreatePayment && dto.paymentMethod) {
      const pm = dto.paymentMethod as PaymentMethod;
      const isTransferLike = pm === 'TRANSFER' || pm === 'INSTALLMENT';
      if (isTransferLike) {
        const transferInn = dto.transferInn?.trim();
        const transferDocuments = normalizeTransferDocuments(dto.transferDocuments);
        if (!transferInn) {
          throw new AppError(400, 'Укажите ИНН компании для перечисления');
        }
        if (transferDocuments.length === 0) {
          throw new AppError(400, 'Выберите минимум один документ для перечисления');
        }
        dilnozaTransferInn = transferInn;
        dilnozaTransferDocuments = JSON.stringify(transferDocuments);
        dilnozaTransferType = dto.transferType ?? 'ONE_TIME';
      } else {
        const note = dto.paymentNote?.trim() || dto.cashNote?.trim();
        if (note) {
          dilnozaTerms = note;
        } else if (pm === 'CLICK' && dto.clickTransactionId?.trim()) {
          dilnozaTerms = `Click: ${dto.clickTransactionId.trim()}`;
        } else {
          dilnozaTerms = null;
        }
      }
    }

    if (canUseDilnozaCreatePayment && dto.createRoute && dto.createRoute !== 'AUTO') {
      if (dto.createRoute === 'STOCK_CONFIRMATION') {
        initialStatus = 'WAITING_STOCK_CONFIRMATION';
        allHaveQtyForTelegram = false;
      } else {
        if (!dto.paymentMethod) {
          throw new AppError(400, 'Выберите способ оплаты для выбранного маршрута');
        }
        const everyFilled = dto.items.every(
          (i) => i.requestedQty != null && Number(i.requestedQty) > 0 && i.price != null && Number(i.price) > 0,
        );
        if (!everyFilled) {
          throw new AppError(
            400,
            'Для маршрута «к зав. склада» или «к бухгалтеру» укажите количество и цену по всем позициям',
          );
        }
        if (dto.createRoute === 'WAREHOUSE_MANAGER') {
          initialStatus = 'WAITING_WAREHOUSE_MANAGER';
          allHaveQtyForTelegram = true;
        } else if (dto.createRoute === 'FINANCE') {
          initialStatus = 'WAITING_FINANCE';
          allHaveQtyForTelegram = true;
        }
      }
    }

    const isSessionDeal = dto.isSessionDeal === true;
    const sessionDealDayStart = isSessionDeal
      ? tashkentDayBoundsFromYmd(currentTashkentYmd()).start
      : undefined;

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
          isSessionDeal,
          paymentMethod: paymentMethodAtCreate,
          paymentType: 'FULL',
          paidAmount: 0,
          paymentStatus: 'UNPAID',
          ...(dto.deliveryType ? { deliveryType: dto.deliveryType as any } : {}),
          ...(dto.vehicleNumber ? { vehicleNumber: dto.vehicleNumber } : {}),
          ...(dto.vehicleType ? { vehicleType: dto.vehicleType } : {}),
          ...(dto.deliveryComment ? { deliveryComment: dto.deliveryComment } : {}),
          ...(dilnozaTerms != null ? { terms: dilnozaTerms } : {}),
          ...(canUseDilnozaCreatePayment &&
            dto.paymentMethod &&
            (dto.paymentMethod === 'TRANSFER' || dto.paymentMethod === 'INSTALLMENT')
            ? {
                transferInn: dilnozaTransferInn,
                transferDocuments: dilnozaTransferDocuments,
                transferType: dilnozaTransferType,
              }
            : {}),
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
            ...(sessionDealDayStart ? { dealDate: sessionDealDayStart } : {}),
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

    void onDealCreated(deal.id, deal.status as DealStatus, allHaveQtyForTelegram).catch((err) => {
      console.error('[Telegram deal groups] onDealCreated:', err);
    });

    if (deal.status === 'WAITING_FINANCE' || deal.status === 'WAITING_WAREHOUSE_MANAGER') {
      void this.notifyAfterDilnozaDirectRoute(
        deal.id,
        deal.title,
        deal.managerId,
        user.userId,
        deal.status as 'WAITING_FINANCE' | 'WAITING_WAREHOUSE_MANAGER',
      ).catch((err) => {
        console.error('[Deals] notifyAfterDilnozaDirectRoute:', err);
      });
    }

    // Return with includes
    return prisma.deal.findUnique({
      where: { id: deal.id },
      include: {
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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

    if (dto.isSessionDeal !== undefined) {
      before.isSessionDeal = deal.isSessionDeal;
      data.isSessionDeal = dto.isSessionDeal;
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

    const prevStatusForTg = deal.status as DealStatus;
    const updated = await prisma.deal.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        contract: { select: { id: true, contractNumber: true } },
      },
    });

    if (dto.status !== undefined && dto.status !== prevStatusForTg) {
      void onDealStatusChanged(id, prevStatusForTg, dto.status as DealStatus).catch((err) => {
        console.error('[Telegram deal groups] onDealStatusChanged:', err);
      });
    }

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
      if (dto.isSessionDeal !== undefined) after.isSessionDeal = updated.isSessionDeal;

      await auditLog({
        userId: user.userId,
        action: 'UPDATE',
        entityType: 'deal',
        entityId: id,
        before: nonStatusBefore,
        after,
      });
    }

    void syncDealTelegramGroupMessages(id).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
    });

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
    const targetStatus: DealStatus = needsFinanceReview ? 'WAITING_FINANCE' : 'WAITING_WAREHOUSE_MANAGER';

    validateStatusTransition(deal.status, targetStatus, user.role);

    // Build update data
    const updateData: Record<string, unknown> = {
      status: targetStatus,
      paymentMethod: dto.paymentMethod as PaymentMethod,
    };

    // Перечисление и рассрочка — одни и те же реквизиты для бухгалтерии
    const methodNeedsTransferPayload =
      dto.paymentMethod === 'TRANSFER' || dto.paymentMethod === 'INSTALLMENT';
    if (methodNeedsTransferPayload) {
      const transferInn = dto.transferInn?.trim();
      const transferDocuments = normalizeTransferDocuments(dto.transferDocuments);

      if (!transferInn) {
        throw new AppError(400, 'Укажите ИНН компании для перечисления');
      }

      if (transferDocuments.length === 0) {
        throw new AppError(400, 'Выберите минимум один документ для перечисления');
      }

      updateData.transferInn = transferInn;
      updateData.transferDocuments = JSON.stringify(transferDocuments);
      updateData.transferType = dto.transferType ?? 'ONE_TIME';
    } else {
      updateData.transferInn = null;
      updateData.transferDocuments = null;
      updateData.transferType = null;
    }

    await prisma.deal.update({
      where: { id: dealId },
      data: updateData,
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: targetStatus, paymentMethod: dto.paymentMethod },
    });

    await Promise.allSettled([
      sendProductionPaymentSubmitTelegram(dealId),
      ...(targetStatus === 'WAITING_FINANCE' ? [trySendFinanceTelegram(dealId)] : []),
    ]);

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

    // Notify warehouse managers when deal goes directly to them (non-finance payments)
    if (targetStatus === 'WAITING_WAREHOUSE_MANAGER') {
      const whManagers = await prisma.user.findMany({
        where: { role: 'WAREHOUSE_MANAGER', isActive: true },
        select: { id: true },
      });

      if (whManagers.length > 0) {
        await prisma.notification.createMany({
          data: whManagers.map((wm) => ({
            userId: wm.id,
            title: 'Новая сделка на обработку',
            body: `Сделка "${deal.title}" ожидает обработки`,
            severity: 'WARNING' as const,
            link: `/deals/${dealId}`,
            createdByUserId: user.userId,
          })),
        });

        pushService.sendPushToRoles(['WAREHOUSE_MANAGER'], {
          title: 'Новая сделка на обработку',
          body: `Сделка "${deal.title}" ожидает обработки`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
        telegramService.sendToRoles(['WAREHOUSE_MANAGER'], {
          title: 'Новая сделка на обработку',
          body: `Сделка "${deal.title}" ожидает обработки`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
      }
    }

    await syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
    });

    return this.findById(dealId, user);
  }

  /** Уведомления при создании сделки Dilnoza сразу в FINANCE или WAITING_WAREHOUSE_MANAGER (аналог хвоста sendToFinance). */
  private async notifyAfterDilnozaDirectRoute(
    dealId: string,
    dealTitle: string,
    managerId: string,
    createdByUserId: string,
    targetStatus: 'WAITING_FINANCE' | 'WAITING_WAREHOUSE_MANAGER',
  ): Promise<void> {
    await Promise.allSettled([
      sendProductionPaymentSubmitTelegram(dealId),
      ...(targetStatus === 'WAITING_FINANCE' ? [trySendFinanceTelegram(dealId)] : []),
    ]);

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
            body: `Сделка "${dealTitle}" ожидает финансовой проверки`,
            severity: 'WARNING' as const,
            link: `/deals/${dealId}`,
            createdByUserId,
          })),
        });
        pushService.sendPushToRoles(['ACCOUNTANT'], {
          title: 'Новая сделка на проверку',
          body: `Сделка "${dealTitle}" ожидает финансовой проверки`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
        telegramService.sendToRoles(['ACCOUNTANT'], {
          title: 'Новая сделка на проверку',
          body: `Сделка "${dealTitle}" ожидает финансовой проверки`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
      }
    }

    if (targetStatus === 'WAITING_WAREHOUSE_MANAGER') {
      const whManagers = await prisma.user.findMany({
        where: { role: 'WAREHOUSE_MANAGER', isActive: true },
        select: { id: true },
      });
      if (whManagers.length > 0) {
        await prisma.notification.createMany({
          data: whManagers.map((wm) => ({
            userId: wm.id,
            title: 'Новая сделка на обработку',
            body: `Сделка "${dealTitle}" ожидает обработки`,
            severity: 'WARNING' as const,
            link: `/deals/${dealId}`,
            createdByUserId,
          })),
        });
        pushService.sendPushToRoles(['WAREHOUSE_MANAGER'], {
          title: 'Новая сделка на обработку',
          body: `Сделка "${dealTitle}" ожидает обработки`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
        telegramService.sendToRoles(['WAREHOUSE_MANAGER'], {
          title: 'Новая сделка на обработку',
          body: `Сделка "${dealTitle}" ожидает обработки`,
          url: `/deals/${dealId}`,
          severity: 'WARNING',
        }).catch(() => {});
      }
    }

    await prisma.notification.create({
      data: {
        userId: managerId,
        title: targetStatus === 'WAITING_FINANCE' ? 'Сделка отправлена в бухгалтерию' : 'Сделка у зав. склада',
        body: `Сделка "${dealTitle}" создана и поставлена в очередь`,
        severity: 'INFO',
        link: `/deals/${dealId}`,
        createdByUserId,
      },
    }).catch(() => {});

    await syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages (dilnoza route):', err);
    });
  }

  // ==================== WAREHOUSE RESPONSE ====================

  async submitWarehouseResponse(dealId: string, dto: WarehouseResponseDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, isArchived: false },
      include: {
        items: {
          include: {
            product: { select: { id: true, salePrice: true } },
          },
        },
      },
    });

    if (!deal) {
      throw new AppError(404, 'Сделка не найдена');
    }

    if (deal.status !== 'WAITING_STOCK_CONFIRMATION') {
      throw new AppError(400, 'Сделка должна быть в статусе "Ожидает подтверждения склада"');
    }

    const canSubmitStock = ['WAREHOUSE', 'LOADER', 'WAREHOUSE_MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role);
    if (!canSubmitStock) {
      throw new AppError(403, 'Недостаточно прав для ответа склада');
    }

    const needsResponse = deal.items.filter((i) => dealItemNeedsStockQty(i));
    const needsIds = new Set(needsResponse.map((i) => i.id));

    if (needsResponse.length === 0) {
      if (dto.items.length > 0) {
        throw new AppError(400, 'Все позиции уже имеют количество; отправьте пустой список items');
      }
      await prisma.$transaction(async (tx) => {
        const rows = await tx.dealItem.findMany({ where: { dealId } });
        if (rows.length === 0) {
          throw new AppError(400, 'В сделке нет позиций');
        }
        const incomplete = rows.find((i) => dealItemNeedsStockQty(i));
        if (incomplete) {
          throw new AppError(400, 'Не у всех позиций указано количество');
        }
        await recalcDealAmountFromItemsInTx(tx, dealId);
        await tx.deal.update({
          where: { id: dealId },
          data: { status: 'IN_PROGRESS' },
        });
      });
    } else {
      if (dto.items.length !== needsResponse.length) {
        throw new AppError(
          400,
          `Нужно ответить ровно по ${needsResponse.length} позициям без количества (получено ${dto.items.length})`,
        );
      }

      const dtoIds = new Set(dto.items.map((i) => i.dealItemId));
      for (const id of needsIds) {
        if (!dtoIds.has(id)) {
          throw new AppError(400, 'Укажите ответ по каждой позиции без количества');
        }
      }

      const dealItemIds = new Set(deal.items.map((i) => i.id));
      for (const item of dto.items) {
        if (!dealItemIds.has(item.dealItemId)) {
          throw new AppError(400, `Позиция ${item.dealItemId} не найдена в сделке`);
        }
        if (!needsIds.has(item.dealItemId)) {
          throw new AppError(400, 'Нельзя менять позиции, у которых количество уже указано менеджером');
        }
      }

      await prisma.$transaction(async (tx) => {
        for (const item of dto.items) {
          const row = deal.items.find((i) => i.id === item.dealItemId);
          if (!row) {
            throw new AppError(400, `Позиция ${item.dealItemId} не найдена`);
          }

          let price = item.price;
          if (price == null || price <= 0) {
            const sp = row.product?.salePrice;
            price = sp != null ? Number(sp) : 0;
          }
          if (!price || price <= 0) {
            throw new AppError(400, 'Укажите цену или задайте цену продажи у товара в каталоге');
          }

          const qty = item.requestedQty;
          const whComment = item.warehouseComment?.trim() || null;
          await tx.dealItem.update({
            where: { id: item.dealItemId },
            data: {
              warehouseComment: whComment,
              requestedQty: qty,
              price,
              lineTotal: qty * price,
              confirmedBy: user.userId,
              confirmedAt: new Date(),
            },
          });
        }

        const afterRows = await tx.dealItem.findMany({ where: { dealId } });
        const incomplete = afterRows.find((i) => dealItemNeedsStockQty(i));
        if (incomplete) {
          throw new AppError(400, 'После ответа у каждой позиции должно быть указано количество');
        }

        await recalcDealAmountFromItemsInTx(tx, dealId);
        await tx.deal.update({
          where: { id: dealId },
          data: { status: 'IN_PROGRESS' },
        });
      });
    }

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'IN_PROGRESS', respondedItems: dto.items.length },
    });

    void cleanupStockWaitTelegramMessages(dealId, 'WAITING_STOCK_CONFIRMATION', 'IN_PROGRESS').catch((err) => {
      console.error('[Telegram deal groups] cleanupStockWaitTelegramMessages:', err);
    });

    void onDealStatusChanged(dealId, deal.status, 'IN_PROGRESS').catch((err) => {
      console.error('[Telegram deal groups] onDealStatusChanged (stock→work):', err);
    });

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
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
    let finalAmount = subtotal - discount;
    if (dto.includeVat === false) {
      finalAmount = Math.round((finalAmount / 1.12) * 100) / 100;
    }
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
          includeVat: dto.includeVat ?? true,
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

    if (newStatus === 'IN_PROGRESS') {
      void trySendProductionTelegram(dealId).catch((err) => {
        console.error('[Telegram deal groups] trySendProductionTelegram:', err);
      });
    }

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
    });

    return this.findById(dealId, user);
  }

  async findForStockConfirmation(_user: AuthUser) {
    const deals = await prisma.deal.findMany({
      where: {
        status: 'WAITING_STOCK_CONFIRMATION',
        isArchived: false,
      },
      include: {
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, stock: true, salePrice: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return deals
      .map((d) => ({
        ...d,
        items: d.items.filter((i) => dealItemNeedsStockQty(i)),
      }))
      .filter((d) => d.items.length > 0);
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

    // After finance approval → warehouse manager for processing
    const targetStatus: DealStatus = 'WAITING_WAREHOUSE_MANAGER';

    // TRANSFER/INSTALLMENT deals require a contract
    if (requiresContract(deal.paymentMethod) && !deal.contractId) {
      throw new AppError(400, 'Для перечисления/рассрочки необходимо привязать договор к сделке');
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

    // Notify warehouse managers about incoming deal
    const whManagers = await prisma.user.findMany({
      where: { role: 'WAREHOUSE_MANAGER', isActive: true },
      select: { id: true },
    });

    if (whManagers.length > 0) {
      await prisma.notification.createMany({
        data: whManagers.map((wm) => ({
          userId: wm.id,
          title: 'Новая сделка после финансовой проверки',
          body: `Сделка "${deal.title}" одобрена бухгалтером — ожидает обработки`,
          severity: 'WARNING' as const,
          link: `/deals/${dealId}`,
          createdByUserId: user.userId,
        })),
      });

      pushService.sendPushToRoles(['WAREHOUSE_MANAGER'], {
        title: 'Новая сделка после финансовой проверки',
        body: `Сделка "${deal.title}" одобрена бухгалтером — ожидает обработки`,
        url: `/deals/${dealId}`,
        severity: 'WARNING',
      }).catch(() => {});
      telegramService.sendToRoles(['WAREHOUSE_MANAGER'], {
        title: 'Новая сделка после финансовой проверки',
        body: `Сделка "${deal.title}" одобрена бухгалтером — ожидает обработки`,
        url: `/deals/${dealId}`,
        severity: 'WARNING',
      }).catch(() => {});
    }

    void sendProductionPaymentSubmitTelegram(dealId).catch((err) => {
      console.error('[Telegram deal groups] sendProductionPaymentSubmitTelegram:', err);
    });

    const [actor, dealAfter] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } }),
      prisma.deal.findUnique({
        where: { id: dealId },
        include: { contract: { select: { contractNumber: true } } },
      }),
    ]);
    const contractNo = dealAfter?.contract?.contractNumber?.trim() || 'не привязан';
    const approveLine = `${actor?.fullName?.trim() || 'Бухгалтер'} подтвердил(а) финансовую проверку. Договор: №${contractNo}`;
    void appendFinanceTelegramLog(dealId, approveLine)
      .then(() => syncDealTelegramGroupMessages(dealId))
      .catch((err) => {
        console.error('[Telegram deal groups] appendFinanceTelegramLog / sync (approve):', err);
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

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages (rejectFinance):', err);
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

    // Accept from ADMIN_APPROVED (already at admin step from finance or direct)
    // or from FINANCE_APPROVED (legacy), or from WAITING_FINANCE if admin
    if (deal.status !== 'ADMIN_APPROVED' && deal.status !== 'FINANCE_APPROVED' && deal.status !== 'WAITING_FINANCE') {
      throw new AppError(400, 'Сделка не готова для одобрения администратором');
    }

    // Contract check for TRANSFER/INSTALLMENT
    if (requiresContract(deal.paymentMethod) && !deal.contractId) {
      throw new AppError(400, 'Для перечисления/рассрочки необходимо привязать договор к сделке');
    }

    const targetStatus: DealStatus = 'READY_FOR_LOADING';

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

    void sendProductionPaymentSubmitTelegram(dealId).catch((err) => {
      console.error('[Telegram deal groups] sendProductionPaymentSubmitTelegram (admin approve):', err);
    });

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages (admin approve):', err);
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
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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
      ...this.parseTransferDocuments(d),
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
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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

  async findClosedDeals(
    user: AuthUser,
    options: {
      page: number;
      limit: number;
      todayOnly?: boolean;
      paymentStatus?: PrismaPaymentStatus;
      managerId?: string;
      closedFrom?: Date;
      closedTo?: Date;
      search?: string;
    },
  ) {
    const { page, limit, todayOnly, paymentStatus, managerId, closedFrom, closedTo, search } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.DealWhereInput = {
      status: 'CLOSED' as DealStatus,
      isArchived: false,
    };

    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }
    if (managerId) {
      where.managerId = managerId;
    }

    if (todayOnly) {
      const { start, end } = tashkentDayBoundsFromYmd(currentTashkentYmd());
      where.closedAt = { gte: start, lte: end };
    } else if (closedFrom || closedTo) {
      where.closedAt = {};
      if (closedFrom) where.closedAt.gte = closedFrom;
      if (closedTo) where.closedAt.lte = closedTo;
    }

    const q = search?.trim();
    if (q) {
      where.AND = [
        {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { client: { companyName: { contains: q, mode: 'insensitive' } } },
            { manager: { fullName: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
          manager: { select: { id: true, fullName: true } },
          deliveryDriver: { select: { id: true, fullName: true } },
          loadingAssignee: { select: { id: true, fullName: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: true, stock: true } },
            },
          },
        },
        orderBy: [{ closedAt: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.deal.count({ where }),
    ]);

    return { data: deals, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async findShipments(user: AuthUser, options: { page: number; limit: number; todayOnly?: boolean }) {
    const { page, limit, todayOnly } = options;
    const skip = (page - 1) * limit;

    const { start, end } = tashkentDayBoundsFromYmd(currentTashkentYmd());

    const where: Prisma.DealWhereInput = {
      isArchived: false,
      shipment: todayOnly
        ? {
            is: {
              departureTime: { gte: start, lte: end },
            },
          }
        : { isNot: null },
    };

    const [shipments, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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
        orderBy: todayOnly
          ? [{ shipment: { departureTime: 'desc' } }]
          : [{ shipment: { shippedAt: 'desc' } }],
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
          client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages (holdShipment):', err);
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
      await this.deductInventoryForDealInTx(tx, dealId, user.userId, 'Автосписание при отгрузке');

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

      const closedAt = resolveClosedAtForNewClose(deal, new Date(dto.departureTime));
      await tx.deal.update({
        where: { id: dealId },
        data: { status: targetStatus, closedAt },
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
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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

    validateStatusTransition(deal.status, 'READY_FOR_LOADING', user.role);

    await prisma.deal.update({
      where: { id: dealId },
      data: { status: 'READY_FOR_LOADING' },
    });

    await auditLog({
      userId: user.userId,
      action: 'STATUS_CHANGE',
      entityType: 'deal',
      entityId: dealId,
      before: { status: deal.status },
      after: { status: 'READY_FOR_LOADING' },
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

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages (rejectDeal):', err);
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
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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

    void syncDealTelegramGroupMessages(id).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
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

      // Оплата для всех сделок, кроме окончательно снятых с учёта
      if (deal.status === 'CANCELED' || deal.status === 'REJECTED') {
        throw new AppError(400, 'Оплата недоступна для отменённых и отклонённых сделок');
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

    await this.syncClosedAtFromTitleIfClosed(dealId);

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

    if (user.role === 'ACCOUNTANT' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      const [actor, dealRow] = await Promise.all([
        prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } }),
        prisma.deal.findUnique({
          where: { id: dealId },
          include: { contract: { select: { contractNumber: true } } },
        }),
      ]);
      const contractNo = dealRow?.contract?.contractNumber?.trim() || 'не привязан';
      const sumStr = new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(dto.amount);
      const notePart = dto.note?.trim() ? ` Примечание: ${dto.note.trim()}` : '';
      const payLine = `${actor?.fullName?.trim() || '—'} добавил(а) платёж ${sumStr} сум.${notePart} Договор: №${contractNo}`;
      void appendFinanceTelegramLog(dealId, payLine)
        .then(() => syncDealTelegramGroupMessages(dealId))
        .catch((err) => {
          console.error('[Telegram deal groups] appendFinanceTelegramLog / sync (payment):', err);
        });
    } else {
      void syncDealTelegramGroupMessages(dealId).catch((err) => {
        console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
      });
    }

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

    await this.syncClosedAtFromTitleIfClosed(dealId);

    await auditLog({
      userId: user.userId, action: 'PAYMENT_UPDATE', entityType: 'deal', entityId: dealId,
      after: { paymentId, ...dto },
    });

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
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

    await this.syncClosedAtFromTitleIfClosed(dealId);

    await auditLog({
      userId: user.userId, action: 'PAYMENT_DELETE', entityType: 'deal', entityId: dealId,
      after: { paymentId, removedAmount: result.removedAmount },
    });

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
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
    let finalAmount = Math.max(0, subtotal - Number(deal.discount));
    
    if (deal.includeVat === false) {
      finalAmount = Math.round((finalAmount / 1.12) * 100) / 100;
    }

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

    assertCanAddOrRemoveDealItem(deal, user);

    const product = await prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || !product.isActive) {
      throw new AppError(404, 'Товар не найден или неактивен');
    }

    const qty = Number(dto.requestedQty);
    const price = Number(dto.price);
    const sessionDealDayStart = deal.isSessionDeal
      ? tashkentDayBoundsFromYmd(currentTashkentYmd()).start
      : undefined;
    const item = await prisma.dealItem.create({
      data: {
        dealId,
        productId: dto.productId,
        requestedQty: qty,
        price,
        lineTotal: qty > 0 && price >= 0 ? qty * price : null,
        requestComment: dto.requestComment,
        ...(sessionDealDayStart ? { dealDate: sessionDealDayStart } : {}),
      },
      include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
    });

    await this.recalcAmount(dealId);

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
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

    assertCanAddOrRemoveDealItem(deal, user);

    const item = await prisma.dealItem.findFirst({
      where: { id: itemId, dealId },
    });

    if (!item) {
      throw new AppError(404, 'Позиция не найдена');
    }

    await prisma.dealItem.delete({ where: { id: itemId } });

    // Recalculate deal amount
    await this.recalcAmount(dealId);

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
    });

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
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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

    void syncDealTelegramGroupMessages(dealId).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
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
        comments: true,
        payments: true,
        shipment: true,
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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
      createdAt: deal.createdAt,
      closedAt: deal.closedAt,
      terms: deal.terms,
      items: deal.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        requestedQty: i.requestedQty != null ? Number(i.requestedQty) : null,
        price: i.price != null ? Number(i.price) : null,
        dealDate: i.dealDate,
        confirmedAt: i.confirmedAt,
        createdAt: i.createdAt,
        shippedAt: i.shippedAt,
        deliveredAt: i.deliveredAt,
      })),
      payments: deal.payments.map((p) => ({
        id: p.id,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
      comments: deal.comments.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
      })),
      shipment: deal.shipment ? {
        vehicleType: deal.shipment.vehicleType,
        vehicleNumber: deal.shipment.vehicleNumber,
        driverName: deal.shipment.driverName,
        departureTime: deal.shipment.departureTime,
        deliveryNoteNumber: deal.shipment.deliveryNoteNumber,
        shippedAt: deal.shipment.shippedAt,
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
      if (dto.dueDate !== undefined) data.dueDate = parseOptionalDate(dto.dueDate);
      if (dto.createdAt !== undefined && dto.createdAt !== null) data.createdAt = parseOptionalDate(dto.createdAt);
      if (dto.closedAt !== undefined) data.closedAt = parseOptionalDate(dto.closedAt);
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

      if (dto.deliveryType !== undefined) data.deliveryType = dto.deliveryType;
      if (dto.vehicleNumber !== undefined) data.vehicleNumber = dto.vehicleNumber;
      if (dto.vehicleType !== undefined) data.vehicleType = dto.vehicleType;
      if (dto.deliveryComment !== undefined) data.deliveryComment = dto.deliveryComment;
      if (dto.loadingAssigneeId !== undefined) data.loadingAssigneeId = dto.loadingAssigneeId;
      if (dto.deliveryDriverId !== undefined) data.deliveryDriverId = dto.deliveryDriverId;

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

        const existingItems = await tx.dealItem.findMany({ where: { dealId: id } });
        const existingItemIds = new Set(existingItems.map((item) => item.id));
        const incomingItemIds = new Set(dto.items.map((item) => item.id).filter((itemId): itemId is string => !!itemId));
        for (const item of dto.items) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product) throw new AppError(404, `Товар ${item.productId} не найден`);
          const qty = item.requestedQty ?? 0;
          const price = item.price ?? 0;
          const itemData = {
            productId: item.productId,
            requestedQty: item.requestedQty ?? null,
            price: item.price ?? null,
            lineTotal: qty > 0 && price > 0 ? qty * price : null,
            requestComment: item.requestComment,
            warehouseComment: item.warehouseComment,
            dealDate: parseOptionalDate(item.dealDate),
            confirmedAt: parseOptionalDate(item.confirmedAt),
            shippedAt: parseOptionalDate(item.shippedAt),
            deliveredAt: parseOptionalDate(item.deliveredAt),
            ...(item.createdAt !== undefined && item.createdAt !== null ? { createdAt: new Date(item.createdAt) } : {}),
          };

          if (item.id) {
            if (!existingItemIds.has(item.id)) {
              throw new AppError(404, `РџРѕР·РёС†РёСЏ ${item.id} РЅРµ РЅР°Р№РґРµРЅР°`);
            }
            await tx.dealItem.update({
              where: { id: item.id },
              data: itemData,
            });
          } else {
            await tx.dealItem.create({
              data: {
                dealId: id,
                ...itemData,
              },
            });
          }
        }

        const idsToDelete = existingItems
          .map((item) => item.id)
          .filter((itemId) => !incomingItemIds.has(itemId));

        if (idsToDelete.length > 0) {
          await tx.dealItem.deleteMany({ where: { id: { in: idsToDelete } } });
        }
      }

      if (dto.payments !== undefined) {
        for (const payment of dto.payments) {
          const existingPayment = await tx.payment.findFirst({
            where: { id: payment.id, dealId: id },
          });
          if (!existingPayment) throw new AppError(404, `РџР»Р°С‚С‘Р¶ ${payment.id} РЅРµ РЅР°Р№РґРµРЅ`);

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              ...(payment.paidAt !== undefined ? { paidAt: parseOptionalDate(payment.paidAt) ?? existingPayment.paidAt } : {}),
              ...(payment.createdAt !== undefined && payment.createdAt !== null ? { createdAt: parseOptionalDate(payment.createdAt) ?? existingPayment.createdAt } : {}),
            },
          });
        }
      }

      if (dto.comments !== undefined) {
        for (const comment of dto.comments) {
          const existingComment = await tx.dealComment.findFirst({
            where: { id: comment.id, dealId: id },
          });
          if (!existingComment) throw new AppError(404, `РљРѕРјРјРµРЅС‚Р°СЂРёР№ ${comment.id} РЅРµ РЅР°Р№РґРµРЅ`);

          if (comment.createdAt !== undefined) {
            await tx.dealComment.update({
              where: { id: comment.id },
              data: {
                createdAt: (comment.createdAt !== null ? parseOptionalDate(comment.createdAt) : existingComment.createdAt) ?? existingComment.createdAt,
              },
            });
          }
        }
      }

      // Shipment upsert
      if (dto.shipment !== undefined) {
        const resolvedShippedAt =
          dto.shipment.shippedAt === undefined
            ? undefined
            : (parseOptionalDate(dto.shipment.shippedAt) ?? deal.shipment?.shippedAt ?? new Date());
        await tx.shipment.upsert({
          where: { dealId: id },
          update: {
            vehicleType: dto.shipment.vehicleType,
            vehicleNumber: dto.shipment.vehicleNumber,
            driverName: dto.shipment.driverName,
            departureTime: new Date(dto.shipment.departureTime),
            deliveryNoteNumber: dto.shipment.deliveryNoteNumber,
            shipmentComment: dto.shipment.shipmentComment,
            ...(dto.shipment.shippedAt !== undefined ? { shippedAt: resolvedShippedAt! } : {}),
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
            ...(dto.shipment.shippedAt !== undefined ? { shippedAt: resolvedShippedAt! } : {}),
          },
        });
      }

      if (dto.status !== undefined && dto.status === 'CLOSED' && deal.status !== 'CLOSED') {
        await this.deductInventoryForDealInTx(tx, id, user.userId);
      }
      if (dto.closedAt === undefined && dto.status !== undefined && dto.status === 'CLOSED' && deal.status !== 'CLOSED') {
        data.closedAt = resolveClosedAtForNewClose(deal, new Date());
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
      include: { items: true, shipment: true, payments: true, comments: true },
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
      dueDate: updatedDeal!.dueDate,
      createdAt: updatedDeal!.createdAt,
      closedAt: updatedDeal!.closedAt,
      items: updatedDeal!.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        requestedQty: i.requestedQty != null ? Number(i.requestedQty) : null,
        price: i.price != null ? Number(i.price) : null,
        dealDate: i.dealDate,
        confirmedAt: i.confirmedAt,
        createdAt: i.createdAt,
        shippedAt: i.shippedAt,
        deliveredAt: i.deliveredAt,
      })),
      payments: updatedDeal!.payments.map((p) => ({
        id: p.id,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
      comments: updatedDeal!.comments.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
      })),
      shipment: updatedDeal!.shipment ? {
        vehicleType: updatedDeal!.shipment.vehicleType,
        vehicleNumber: updatedDeal!.shipment.vehicleNumber,
        driverName: updatedDeal!.shipment.driverName,
        departureTime: updatedDeal!.shipment.departureTime,
        deliveryNoteNumber: updatedDeal!.shipment.deliveryNoteNumber,
        shippedAt: updatedDeal!.shipment.shippedAt,
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

    if (dto.status !== undefined && dto.status !== deal.status) {
      void onDealStatusChanged(id, deal.status as DealStatus, dto.status as DealStatus).catch((err) => {
        console.error('[Telegram deal groups] onDealStatusChanged (override):', err);
      });
    }

    void syncDealTelegramGroupMessages(id).catch((err) => {
      console.error('[Telegram deal groups] syncDealTelegramGroupMessages:', err);
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
        client: { select: { id: true, companyName: true, isSvip: true, creditStatus: true } },
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

  private parseTransferDocuments<T extends Record<string, unknown>>(deal: T): T & {
    transferDocuments?: string[] | null;
  } {
    if (!deal.transferDocuments || typeof deal.transferDocuments !== 'string') {
      return deal as T & { transferDocuments?: string[] | null };
    }
    try {
      const parsed = JSON.parse(deal.transferDocuments as string);
      const normalized = normalizeTransferDocuments(parsed);
      return {
        ...deal,
        transferDocuments: normalized.length > 0 ? normalized : null,
      } as T & { transferDocuments?: string[] | null };
    } catch {
      return {
        ...deal,
        transferDocuments: null,
      } as T & { transferDocuments?: string[] | null };
    }
  }

  // ==================== NEW WORKFLOW: Warehouse Manager / Loading / Delivery ====================

  async findForWarehouseManager(_user: AuthUser) {
    return prisma.deal.findMany({
      where: { status: 'WAITING_WAREHOUSE_MANAGER', isArchived: false },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { name: true, unit: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findApprovedForLoading(_user: AuthUser) {
    return prisma.deal.findMany({
      where: { status: 'READY_FOR_LOADING', isArchived: false },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        deliveryDriver: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { name: true, unit: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findForDeliveryAssignment(_user: AuthUser) {
    return prisma.deal.findMany({
      where: { status: 'READY_FOR_DELIVERY', isArchived: false },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, address: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { name: true, unit: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMyLoadingTasks(user: AuthUser) {
    const seeAll = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'WAREHOUSE_MANAGER';
    return prisma.deal.findMany({
      where: {
        status: 'LOADING_ASSIGNED',
        ...(!seeAll ? { loadingAssigneeId: user.userId } : {}),
        isArchived: false,
      },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        loadingAssignee: { select: { id: true, fullName: true } },
        deliveryDriver: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { name: true, unit: true } } }, orderBy: { createdAt: 'asc' } },
        rating: { select: { token: true, rating: true, ratedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMyVehicle(user: AuthUser) {
    const seeAll = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'WAREHOUSE_MANAGER';
    return prisma.deal.findMany({
      where: {
        status: 'IN_DELIVERY',
        ...(!seeAll ? { deliveryDriverId: user.userId } : {}),
        isArchived: false,
      },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, address: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        deliveryDriver: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { name: true, unit: true } } }, orderBy: { createdAt: 'asc' } },
        rating: { select: { token: true, rating: true, ratedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Зав.склада: «Пришли за товарами» / «Машина готова» → PENDING_ADMIN */
  async warehouseManagerConfirm(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, status: 'WAITING_WAREHOUSE_MANAGER', isArchived: false },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена или не в нужном статусе');

    validateStatusTransition(deal.status, 'PENDING_ADMIN', user.role);

    await prisma.deal.update({ where: { id: dealId }, data: { status: 'PENDING_ADMIN' } });

    await auditLog({ userId: user.userId, action: 'STATUS_CHANGE', entityType: 'deal', entityId: dealId, before: { status: deal.status }, after: { status: 'PENDING_ADMIN' } });

    const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true }, select: { id: true } });
    if (admins.length > 0) {
      await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, title: 'Сделка ожидает одобрения', body: `Сделка "${deal.title}" готова — ожидает вашего одобрения`, severity: 'WARNING' as const, link: `/deals/${dealId}`, createdByUserId: user.userId })) });
      pushService.sendPushToRoles(['ADMIN', 'SUPER_ADMIN'], { title: 'Сделка ожидает одобрения', body: `Сделка "${deal.title}" готова`, url: `/deals/${dealId}`, severity: 'WARNING' }).catch(() => {});
    }

    void trySendAdminApprovalTelegram(dealId).catch(() => {});
    void syncDealTelegramGroupMessages(dealId).catch(() => {});
  }

  /** Админ: одобрить → READY_FOR_LOADING */
  async approveByAdmin(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, status: 'PENDING_ADMIN', isArchived: false },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена или не в нужном статусе');

    validateStatusTransition(deal.status, 'READY_FOR_LOADING', user.role);

    await prisma.deal.update({ where: { id: dealId }, data: { status: 'READY_FOR_LOADING' } });

    await auditLog({ userId: user.userId, action: 'STATUS_CHANGE', entityType: 'deal', entityId: dealId, before: { status: deal.status }, after: { status: 'READY_FOR_LOADING' } });

    const whManagers = await prisma.user.findMany({ where: { role: 'WAREHOUSE_MANAGER', isActive: true }, select: { id: true } });
    if (whManagers.length > 0) {
      await prisma.notification.createMany({ data: whManagers.map((wm) => ({ userId: wm.id, title: 'Сделка одобрена', body: `Сделка "${deal.title}" одобрена админом — назначьте сотрудника на отгрузку`, severity: 'WARNING' as const, link: `/deals/${dealId}`, createdByUserId: user.userId })) });
      pushService.sendPushToRoles(['WAREHOUSE_MANAGER'], { title: 'Сделка одобрена', body: `Сделка "${deal.title}" одобрена — назначьте на отгрузку`, url: `/deals/${dealId}`, severity: 'WARNING' }).catch(() => {});
    }

    void syncDealTelegramGroupMessages(dealId).catch(() => {});
  }

  /** Админ: отклонить из PENDING_ADMIN → REJECTED */
  async rejectByAdmin(dealId: string, reason: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, status: 'PENDING_ADMIN', isArchived: false },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена или не в нужном статусе');

    validateStatusTransition(deal.status, 'REJECTED', user.role);

    await prisma.deal.update({ where: { id: dealId }, data: { status: 'REJECTED' } });
    await prisma.dealComment.create({ data: { dealId, authorId: user.userId, text: `Отклонено админом: ${reason}` } });

    await auditLog({ userId: user.userId, action: 'STATUS_CHANGE', entityType: 'deal', entityId: dealId, before: { status: deal.status }, after: { status: 'REJECTED' } });

    pushService.sendPushToUser(deal.managerId, { title: 'Сделка отклонена', body: `Сделка "${deal.title}" отклонена: ${reason}`, url: `/deals/${dealId}`, severity: 'URGENT' }).catch(() => {});

    void syncDealTelegramGroupMessages(dealId).catch(() => {});
  }

  /** Зав.склада: назначить водителя для DELIVERY (до назначения грузчика) — статус НЕ меняется */
  async assignDriver(dealId: string, dto: AssignDriverDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, status: 'READY_FOR_LOADING', deliveryType: 'DELIVERY', isArchived: false },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена или не в статусе READY_FOR_LOADING / не доставка');

    const driver = await prisma.user.findFirst({
      where: { id: dto.driverId, role: 'DRIVER', isActive: true },
    });
    if (!driver) throw new AppError(400, 'Водитель не найден или не активен');

    await prisma.deal.update({ where: { id: dealId }, data: { deliveryDriverId: dto.driverId } });

    await auditLog({ userId: user.userId, action: 'UPDATE', entityType: 'deal', entityId: dealId, before: { deliveryDriverId: null }, after: { deliveryDriverId: dto.driverId } });

    await prisma.notification.create({ data: { userId: dto.driverId, title: 'Назначена доставка', body: `Сделка "${deal.title}" — товар будет загружен в вашу машину`, severity: 'INFO', link: `/my-vehicle`, createdByUserId: user.userId } });
  }

  /** Зав.склада: назначить сотрудника на отгрузку */
  async assignLoading(dealId: string, dto: AssignLoadingDto, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, status: 'READY_FOR_LOADING', isArchived: false },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена или не в нужном статусе');

    if (deal.deliveryType === 'DELIVERY' && !deal.deliveryDriverId) {
      throw new AppError(400, 'Сначала назначьте водителя, потом грузчика');
    }

    const assignee = await prisma.user.findFirst({
      where: { id: dto.assigneeId, role: { in: ['WAREHOUSE', 'DRIVER', 'LOADER'] }, isActive: true },
    });
    if (!assignee) throw new AppError(400, 'Сотрудник не найден или не может быть назначен');

    await prisma.deal.update({ where: { id: dealId }, data: { status: 'LOADING_ASSIGNED', loadingAssigneeId: dto.assigneeId } });

    // Create rating token for QR code (if not yet created)
    const existingRating = await prisma.dealRating.findUnique({ where: { dealId } });
    if (!existingRating) {
      await prisma.dealRating.create({
        data: { dealId, token: crypto.randomBytes(16).toString('hex') },
      });
    }

    await auditLog({ userId: user.userId, action: 'STATUS_CHANGE', entityType: 'deal', entityId: dealId, before: { status: deal.status }, after: { status: 'LOADING_ASSIGNED', loadingAssigneeId: dto.assigneeId } });

    await prisma.notification.create({ data: { userId: dto.assigneeId, title: 'Новое поручение на отгрузку', body: `Сделка "${deal.title}" — нужно отгрузить`, severity: 'WARNING', link: `/my-loading-tasks`, createdByUserId: user.userId } });
    pushService.sendPushToUser(dto.assigneeId, { title: 'Новое поручение на отгрузку', body: `Сделка "${deal.title}" — нужно отгрузить`, url: `/my-loading-tasks`, severity: 'WARNING' }).catch(() => {});

    void syncDealTelegramGroupMessages(dealId).catch(() => {});
  }

  /** Сотрудник: «Отгружено» — сразу списание со склада; затем CLOSED (самовывоз/яндекс) или IN_DELIVERY (доставка). */
  async markLoaded(dealId: string, user: AuthUser) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, status: 'LOADING_ASSIGNED', isArchived: false },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена или не в нужном статусе');

    const canAct = deal.loadingAssigneeId === user.userId
      || user.role === 'WAREHOUSE_MANAGER'
      || user.role === 'SUPER_ADMIN';
    if (!canAct) {
      throw new AppError(403, 'Только назначенный сотрудник, зав. склада или супер-админ может отметить отгрузку');
    }

    const isDelivery = deal.deliveryType === 'DELIVERY';
    const targetStatus: DealStatus = isDelivery ? 'IN_DELIVERY' : 'CLOSED';

    await prisma.$transaction(async (tx) => {
      await this.deductInventoryForDealInTx(tx, dealId, user.userId, 'Автосписание при отметке «Отгружено»');
      if (targetStatus === 'CLOSED') {
        const closedAt = resolveClosedAtForNewClose(deal, new Date());
        await tx.deal.update({
          where: { id: dealId },
          data: { status: 'CLOSED', closedAt },
        });
      } else {
        await tx.deal.update({ where: { id: dealId }, data: { status: targetStatus } });
      }
    });

    await auditLog({ userId: user.userId, action: 'STATUS_CHANGE', entityType: 'deal', entityId: dealId, before: { status: deal.status }, after: { status: targetStatus } });

    if (isDelivery && deal.deliveryDriverId) {
      await prisma.notification.create({ data: { userId: deal.deliveryDriverId, title: 'Товар загружен', body: `Сделка "${deal.title}" загружена в вашу машину`, severity: 'WARNING', link: `/my-vehicle`, createdByUserId: user.userId } });
      pushService.sendPushToUser(deal.deliveryDriverId, { title: 'Товар загружен', body: `Сделка "${deal.title}" загружена в вашу машину`, url: `/my-vehicle`, severity: 'WARNING' }).catch(() => {});
    }

    void syncDealTelegramGroupMessages(dealId).catch(() => {});
  }

  /** Водитель: «Поехали» — отмечает выезд (НЕ закрывает) */
  async startDelivery(dto: StartDeliveryDto, user: AuthUser) {
    const deals = await prisma.deal.findMany({
      where: { id: { in: dto.dealIds }, status: 'IN_DELIVERY', deliveryDriverId: user.userId, isArchived: false },
    });

    if (deals.length === 0) throw new AppError(400, 'Нет доступных сделок для отправки');

    for (const deal of deals) {
      await prisma.dealComment.create({ data: { dealId: deal.id, authorId: user.userId, text: '🚗 Водитель выехал на доставку' } });
      await auditLog({ userId: user.userId, action: 'UPDATE', entityType: 'deal', entityId: deal.id, before: {}, after: { departed: true } });
    }

    return { departedCount: deals.length };
  }

  /** Водитель/зав.склада/супер-админ: «Доставлено» — закрывает сделку (склад уже списан при «Отгружено»). */
  async deliverDeal(dealId: string, user: AuthUser) {
    const canActAny = user.role === 'WAREHOUSE_MANAGER' || user.role === 'SUPER_ADMIN';
    const deal = await prisma.deal.findFirst({
      where: {
        id: dealId,
        status: 'IN_DELIVERY',
        ...(!canActAny ? { deliveryDriverId: user.userId } : {}),
        isArchived: false,
      },
    });
    if (!deal) throw new AppError(404, 'Сделка не найдена или нет прав для завершения доставки');

    const closedAt = resolveClosedAtForNewClose(deal, new Date());
    await prisma.deal.update({
      where: { id: deal.id },
      data: { status: 'CLOSED', closedAt },
    });
    await auditLog({ userId: user.userId, action: 'STATUS_CHANGE', entityType: 'deal', entityId: deal.id, before: { status: deal.status }, after: { status: 'CLOSED' } });
    void syncDealTelegramGroupMessages(deal.id).catch(() => {});
  }

  /** Список сотрудников, доступных для назначения на отгрузку */
  async getLoadingStaff() {
    return prisma.user.findMany({
      where: { role: { in: ['WAREHOUSE', 'DRIVER', 'LOADER'] }, isActive: true },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }

  /** Список водителей */
  async getDrivers() {
    return prisma.user.findMany({
      where: { role: 'DRIVER', isActive: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  /** Сделки PENDING_ADMIN для одобрения */
  async findPendingAdmin(_user: AuthUser) {
    return prisma.deal.findMany({
      where: { status: 'PENDING_ADMIN', isArchived: false },
      include: {
        client: { select: { id: true, companyName: true, contactName: true, isSvip: true, creditStatus: true } },
        manager: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { name: true, unit: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
  // ==================== PAYMENT RECEIPT ====================

  async generatePaymentReceipt(dealId: string, user: AuthUser): Promise<{ buffer: Buffer; filename: string }> {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, ...ownerScope(user) },
      include: {
        client: {
          select: {
            companyName: true, contactName: true, inn: true,
            address: true, phone: true,
          },
        },
        manager: { select: { fullName: true } },
        items: {
          include: { product: { select: { name: true, sku: true, unit: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!deal) throw new AppError(404, 'Сделка не найдена');

    const payments = await prisma.payment.findMany({
      where: { dealId },
      include: { creator: { select: { fullName: true } } },
      orderBy: { paidAt: 'asc' },
    });

    const company = await prisma.companySettings.findFirst({ where: { id: 'singleton' } });

    const VAT_RATE = 0.12;
    let subtotalBase = 0;
    let subtotalVat = 0;
    const items = deal.items.map((it, i) => {
      const qty = Number(it.requestedQty) || 0;
      const priceWithVat = Number(it.price) || 0;
      const totalWithVat = Math.round(qty * priceWithVat * 100) / 100;
      const vatAmount = Math.round((totalWithVat * VAT_RATE / (1 + VAT_RATE)) * 100) / 100;
      const sumWithoutVat = Math.round((totalWithVat - vatAmount) * 100) / 100;
      subtotalBase += sumWithoutVat;
      subtotalVat += vatAmount;
      return {
        num: i + 1,
        name: it.product.name,
        unit: it.product.unit,
        qty,
        priceWithVat,
        totalWithVat,
        vatAmount,
        sumWithoutVat,
      };
    });

    const totalAmount = Number(deal.amount) || 0;
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

    const { buildPaymentReceiptHtml, generateDocumentPdf } = await import('../../lib/pdf-generator');
    const companyForPdf = company ? {
      companyName: company.companyName,
      inn: company.inn,
      address: company.address,
      phone: company.phone,
      email: company.email,
      bankName: company.bankName,
      bankAccount: company.bankAccount,
      mfo: company.mfo,
      director: company.director,
      logoPath: company.logoPath,
      vatRegCode: company.vatRegCode,
      oked: company.oked,
    } : null;

    const html = buildPaymentReceiptHtml(
      {
        dealTitle: deal.title,
        dealId: deal.id,
        closedAt: deal.closedAt?.toISOString() ?? null,
        includeVat: deal.includeVat ?? true,
        client: deal.client ? {
          companyName: deal.client.companyName,
          contactName: deal.client.contactName ?? '',
          inn: deal.client.inn ?? null,
          address: deal.client.address ?? null,
          phone: deal.client.phone ?? null,
        } : null,
        manager: deal.manager ? { fullName: deal.manager.fullName } : null,
        items,
        payments: payments.map((p, i) => ({
          num: i + 1,
          amount: Number(p.amount),
          method: p.method,
          paidAt: p.paidAt.toISOString(),
        })),
        totalAmount,
        totalPaid,
        remaining: Math.max(0, totalAmount - totalPaid),
        subtotalBase: Math.round(subtotalBase * 100) / 100,
        subtotalVat: Math.round(subtotalVat * 100) / 100,
      },
      companyForPdf,
    );

    const buffer = await generateDocumentPdf([html], {
      margin: { top: '5mm', bottom: '5mm', left: '5mm', right: '5mm' },
    });
    const safeName = deal.title.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
    return { buffer, filename: `receipt_${safeName}.pdf` };
  }
}

export const dealsService = new DealsService();
