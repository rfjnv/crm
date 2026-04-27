import { DealStatus, Client, ClientCreditStatus, Prisma, DeliveryType } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser, clientOwnerScope } from '../../lib/scope';
import {
  CreateClientDto,
  UpdateClientDto,
  AddClientStockDto,
  SendClientStockAllDto,
  SendClientStockPartialDto,
  SuperCorrectClientStockAddDto,
  SuperDeleteClientStockAddDto,
} from './clients.dto';
import {
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_LINE_REVENUE_DI,
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_CLIENT_STOCK_ADD_LINE,
} from '../../lib/analytics';

function clientAuditSnapshot(c: Client) {
  return {
    id: c.id,
    companyName: c.companyName,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    address: c.address,
    latitude: c.latitude,
    longitude: c.longitude,
    notes: c.notes,
    inn: c.inn,
    bankName: c.bankName,
    bankAccount: c.bankAccount,
    mfo: c.mfo,
    vatRegCode: c.vatRegCode,
    oked: c.oked,
    portraitProfile: c.portraitProfile,
    portraitGoals: c.portraitGoals,
    portraitPains: c.portraitPains,
    portraitFears: c.portraitFears,
    portraitObjections: c.portraitObjections,
    managerId: c.managerId,
    isSvip: c.isSvip,
    creditStatus: c.creditStatus,
    isArchived: c.isArchived,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

interface DealFilters {
  dealStatus?: DealStatus;
  from?: string;
  to?: string;
}

type LatestNoteRow = {
  id: string;
  clientId: string;
  content: string;
  createdAt: Date;
  authorName: string;
};

type LatestDealManagerRow = {
  clientId: string;
  managerId: string;
  managerName: string;
};

type ClientStockRevenueRow = {
  day: Date;
  amount: string;
};

type ClientStockTopProductRow = {
  product_id: string;
  total_qty: string;
};

export class ClientsService {
  /**
   * Client list: 1 query for clients + manager, then 3 batched queries (latest note per client,
   * max deal date per client, max payment date per client) — fixed query count, no N+1.
   */
  async findAll(user: AuthUser) {
    const rows = await prisma.client.findMany({
      where: { ...clientOwnerScope(user), isArchived: false },
      include: {
        manager: { select: { id: true, fullName: true } },
      },
    });

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return [];
    }

    const [noteRows, dealsAgg, paysAgg, latestDealManagers] = await Promise.all([
      prisma.$queryRaw<LatestNoteRow[]>(Prisma.sql`
        SELECT DISTINCT ON (cn.client_id)
          cn.id,
          cn.client_id AS "clientId",
          cn.content,
          cn.created_at AS "createdAt",
          u.full_name AS "authorName"
        FROM client_notes cn
        INNER JOIN users u ON u.id = cn.user_id
        WHERE cn.deleted_at IS NULL
          AND cn.client_id IN (${Prisma.join(ids)})
        ORDER BY cn.client_id, cn.created_at DESC
      `),
      prisma.deal.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids }, isArchived: false },
        _max: { createdAt: true },
      }),
      prisma.payment.groupBy({
        by: ['clientId'],
        where: { clientId: { in: ids } },
        _max: { paidAt: true },
      }),
      prisma.$queryRaw<LatestDealManagerRow[]>(Prisma.sql`
        SELECT DISTINCT ON (d.client_id)
          d.client_id AS "clientId",
          u.id AS "managerId",
          u.full_name AS "managerName"
        FROM deals d
        INNER JOIN users u ON u.id = d.manager_id
        WHERE d.is_archived = false
          AND d.client_id IN (${Prisma.join(ids)})
        ORDER BY d.client_id, d.created_at DESC
      `),
    ]);

    const noteByClient = new Map(noteRows.map((n) => [n.clientId, n]));
    const dealMaxByClient = new Map(
      dealsAgg.map((d) => [d.clientId, d._max.createdAt?.getTime() ?? 0]),
    );
    const payMaxByClient = new Map(
      paysAgg.map((p) => [p.clientId, p._max.paidAt?.getTime() ?? 0]),
    );
    const dealManagerByClient = new Map(
      latestDealManagers.map((dm) => [dm.clientId, { id: dm.managerId, fullName: dm.managerName }]),
    );

    return rows.map((client) => {
      const latestNote = noteByClient.get(client.id);
      const noteMs = latestNote?.createdAt.getTime() ?? 0;
      const lastMs = Math.max(
        client.updatedAt.getTime(),
        client.createdAt.getTime(),
        dealMaxByClient.get(client.id) ?? 0,
        payMaxByClient.get(client.id) ?? 0,
        noteMs,
      );
      const preview =
        latestNote && latestNote.content.length > 140
          ? `${latestNote.content.slice(0, 140)}…`
          : latestNote?.content ?? null;

      const latestDealManager = dealManagerByClient.get(client.id);

      return {
        ...client,
        manager: latestDealManager ?? client.manager,
        lastContactAt: new Date(lastMs).toISOString(),
        lastNote: latestNote
          ? {
              id: latestNote.id,
              preview,
              createdAt: latestNote.createdAt.toISOString(),
              authorName: latestNote.authorName,
            }
          : null,
      };
    });
  }

  async findById(id: string, user: AuthUser, filters?: DealFilters) {
    // Build deals where clause
    const dealsWhere: Record<string, unknown> = { isArchived: false };

    if (filters?.dealStatus) {
      dealsWhere.status = filters.dealStatus;
    }

    // Date range filter — only apply when explicitly provided
    if (filters?.from || filters?.to) {
      const dateFilter: Record<string, Date> = {};
      if (filters.from) dateFilter.gte = new Date(filters.from);
      if (filters.to) {
        const toDate = new Date(filters.to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.lte = toDate;
      }
      dealsWhere.createdAt = dateFilter;
    }

    const client = await prisma.client.findFirst({
      where: { id, ...clientOwnerScope(user) },
      include: {
        manager: { select: { id: true, fullName: true } },
        contracts: {
          where: { isActive: true },
          select: { id: true, contractNumber: true },
          orderBy: { createdAt: 'desc' },
        },
        deals: {
          where: dealsWhere,
          select: {
            id: true,
            title: true,
            status: true,
            amount: true,
            paidAmount: true,
            paymentStatus: true,
            paymentType: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    return client;
  }

  async create(dto: CreateClientDto, user: AuthUser) {
    // Admins can assign any manager; others always get themselves
    let managerId = user.userId;
    if (dto.managerId) {
      const canAssign = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'OPERATOR';
      if (!canAssign) {
        throw new AppError(403, 'Недостаточно прав для назначения менеджера');
      }
      const manager = await prisma.user.findUnique({ where: { id: dto.managerId } });
      if (!manager || !manager.isActive) {
        throw new AppError(404, 'Менеджер не найден или неактивен');
      }
      managerId = dto.managerId;
    }

    const { managerId: _ignoreManagerId, ...rest } = dto;
    const client = await prisma.client.create({
      data: {
        ...rest,
        managerId,
      },
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'client',
      entityId: client.id,
      after: { companyName: client.companyName, contactName: client.contactName },
    });

    return client;
  }

  async update(id: string, dto: UpdateClientDto, user: AuthUser) {
    const client = await prisma.client.findFirst({
      where: { id, ...clientOwnerScope(user) },
    });

    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    const isElevated = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
    const hasEditClient = user.permissions.includes('edit_client');
    const isOwner = client.managerId === user.userId;

    if (!isElevated && !hasEditClient && !isOwner) {
      throw new AppError(403, 'Недостаточно прав для редактирования клиента');
    }

    if (dto.managerId) {
      if (!isElevated) {
        throw new AppError(403, 'Только администратор может менять менеджера');
      }
      const manager = await prisma.user.findUnique({ where: { id: dto.managerId } });
      if (!manager || !manager.isActive) {
        throw new AppError(404, 'Менеджер не найден или неактивен');
      }
    }

    const before = clientAuditSnapshot(client);

    const updated = await prisma.client.update({
      where: { id },
      data: dto,
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE_CLIENT',
      entityType: 'client',
      entityId: id,
      before,
      after: clientAuditSnapshot(updated),
    });

    return updated;
  }

  async toggleSvip(id: string, user: AuthUser) {
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только администратор может менять статус SVIP');
    }

    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    const updated = await prisma.client.update({
      where: { id },
      data: { isSvip: !client.isSvip },
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE_CLIENT',
      entityType: 'client',
      entityId: id,
      before: { isSvip: client.isSvip },
      after: { isSvip: updated.isSvip },
    });

    return updated;
  }

  async setCreditStatus(id: string, creditStatus: ClientCreditStatus, user: AuthUser) {
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только администратор может менять кредитный статус клиента');
    }

    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    const updated = await prisma.client.update({
      where: { id },
      data: { creditStatus },
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE_CLIENT',
      entityType: 'client',
      entityId: id,
      before: { creditStatus: client.creditStatus },
      after: { creditStatus: updated.creditStatus },
    });

    return updated;
  }

  async normalizeAllPhones(): Promise<{ total: number; updated: number; details: string[] }> {
    const clients = await prisma.client.findMany({
      where: { phone: { not: null } },
      select: { id: true, companyName: true, phone: true },
    });

    const details: string[] = [];
    let updated = 0;

    for (const c of clients) {
      const raw = (c.phone ?? '').trim();
      if (!raw) continue;

      let digits = raw.replace(/[^0-9]/g, '');
      if (digits.length === 12 && digits.startsWith('998')) digits = digits.slice(3);
      if (digits.length > 9 && digits.startsWith('998')) digits = digits.slice(3);
      if (digits.length > 9) digits = digits.slice(-9);
      if (digits.length !== 9) continue;

      const formatted = `+998 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
      if (formatted === raw) continue;

      await prisma.client.update({ where: { id: c.id }, data: { phone: formatted } });
      details.push(`${c.companyName}: ${raw} → ${formatted}`);
      updated++;
    }

    return { total: clients.length, updated, details };
  }

  async archive(id: string, user: AuthUser) {
    // Only ADMIN can archive
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только администратор может архивировать клиентов');
    }

    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    const updated = await prisma.client.update({
      where: { id },
      data: { isArchived: true },
    });

    await auditLog({
      userId: user.userId,
      action: 'ARCHIVE',
      entityType: 'client',
      entityId: id,
      before: { isArchived: false },
      after: { isArchived: true },
    });

    return updated;
  }

  /** Пересчёт цепочки qtyBefore/qtyAfter и итоговой позиции по (клиент, товар). */
  private async replayClientStockChain(
    tx: Prisma.TransactionClient,
    clientId: string,
    productId: string,
  ) {
    const events = await tx.clientStockEvent.findMany({
      where: { clientId, productId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, qtyDelta: true },
    });
    let running = new Prisma.Decimal(0);
    for (const ev of events) {
      const qtyBefore = running;
      running = running.plus(ev.qtyDelta);
      await tx.clientStockEvent.update({
        where: { id: ev.id },
        data: { qtyBefore, qtyAfter: running },
      });
    }
    if (events.length === 0) {
      await tx.clientStockPosition.deleteMany({ where: { clientId, productId } });
      return;
    }
    await tx.clientStockPosition.upsert({
      where: { clientId_productId: { clientId, productId } },
      create: { clientId, productId, qtyTotal: running },
      update: { qtyTotal: running },
    });
  }

  /** Проверка: если убрать событие из цепочки, остаток нигде не уходит в минус. */
  private assertClientStockChainOkWithoutEvent(
    events: { id: string; qtyDelta: Prisma.Decimal }[],
    skipEventId: string,
  ) {
    let running = new Prisma.Decimal(0);
    for (const ev of events) {
      if (ev.id === skipEventId) continue;
      running = running.plus(ev.qtyDelta);
      if (running.lt(0)) {
        throw new AppError(
          400,
          'Нельзя удалить поступление: после удаления остаток у клиента стал бы отрицательным (есть последующие отгрузки со склада клиента). ' +
            'Если сделку уже удалили, а в истории осталась «Отправка в работу» без сделки — включите опцию «Убрать застрявшие резервы без сделки» и повторите удаление.',
        );
      }
    }
  }

  /**
   * Суперадмин: удалить поступление ADD (ошибочная запись). Возвращает количество на основной склад.
   */
  async superDeleteClientStockAddEvent(
    clientId: string,
    eventId: string,
    dto: SuperDeleteClientStockAddDto,
    user: AuthUser,
  ) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только суперадминистратор может удалять историю склада клиента');
    }

    const event = await prisma.clientStockEvent.findFirst({
      where: { id: eventId, clientId },
      include: { product: { select: { name: true } } },
    });
    if (!event || event.type !== 'ADD') {
      throw new AppError(404, 'Событие не найдено или не является поступлением (ADD)');
    }

    const oldQty = Number(event.qtyDelta);
    const beforeSnap = {
      qtyDelta: oldQty,
      createdAt: event.createdAt.toISOString(),
      unitPrice: event.unitPrice != null ? event.unitPrice.toString() : null,
      lineTotal: event.lineTotal != null ? event.lineTotal.toString() : null,
    };

    let removedOrphanReserveIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      if (dto.removeOrphanReservesFirst) {
        const orphans = await tx.clientStockEvent.findMany({
          where: {
            clientId,
            productId: event.productId,
            type: 'RESERVE_TO_DEAL',
            sourceDealId: null,
          },
          select: { id: true },
        });
        if (orphans.length > 0) {
          removedOrphanReserveIds = orphans.map((o) => o.id);
          const oids = removedOrphanReserveIds;
          await tx.inventoryMovement.updateMany({
            where: { clientStockEventId: { in: oids } },
            data: { clientStockEventId: null },
          });
          await tx.clientStockEvent.deleteMany({ where: { id: { in: oids } } });
          await this.replayClientStockChain(tx, clientId, event.productId);
        }
      }

      const chain = await tx.clientStockEvent.findMany({
        where: { clientId, productId: event.productId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, qtyDelta: true },
      });
      this.assertClientStockChainOkWithoutEvent(chain, eventId);

      await tx.product.update({
        where: { id: event.productId },
        data: { stock: { increment: oldQty } },
      });

      const mov =
        (await tx.inventoryMovement.findFirst({
          where: { clientStockEventId: eventId },
        })) ||
        (await tx.inventoryMovement.findFirst({
          where: {
            productId: event.productId,
            type: 'OUT',
            createdBy: event.authorId,
            quantity: event.qtyDelta,
            createdAt: {
              gte: new Date(event.createdAt.getTime() - 15_000),
              lte: new Date(event.createdAt.getTime() + 15_000),
            },
          },
          orderBy: { createdAt: 'asc' },
        }));

      if (mov) {
        await tx.inventoryMovement.delete({ where: { id: mov.id } });
      }

      await tx.clientStockEvent.delete({ where: { id: eventId } });
      await this.replayClientStockChain(tx, clientId, event.productId);
    });

    await auditLog({
      userId: user.userId,
      action: 'OVERRIDE_DELETE',
      entityType: 'client_stock_event',
      entityId: eventId,
      before: beforeSnap,
      after: {
        deleted: true,
        reason: dto.reason ?? null,
        ...(removedOrphanReserveIds.length > 0 ? { removedOrphanReserveIds } : {}),
      },
      reason: dto.reason,
    });

    return this.getStock(clientId, user, { historyLimit: 100 });
  }

  /**
   * Суперадмин: исправить количество и/или фактическую дату поступления на склад клиента (ADD),
   * чтобы выручка и движения склада попадали в нужный день. Синхронизирует остаток основного склада и движение OUT.
   */
  async superCorrectClientStockAddEvent(
    clientId: string,
    eventId: string,
    dto: SuperCorrectClientStockAddDto,
    user: AuthUser,
  ) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только суперадминистратор может править историю склада клиента');
    }

    const event = await prisma.clientStockEvent.findFirst({
      where: { id: eventId, clientId },
      include: { product: { select: { name: true } } },
    });
    if (!event || event.type !== 'ADD') {
      throw new AppError(404, 'Событие не найдено или не является поступлением (ADD)');
    }

    const oldQty = Number(event.qtyDelta);
    const newQty = dto.qty !== undefined ? dto.qty : oldQty;
    if (newQty <= 0) {
      throw new AppError(400, 'Количество должно быть больше 0');
    }

    let newCreatedAt = event.createdAt;
    if (dto.occurredAt !== undefined && dto.occurredAt.trim().length > 0) {
      const d = new Date(dto.occurredAt);
      if (Number.isNaN(d.getTime())) {
        throw new AppError(400, 'Некорректная дата');
      }
      newCreatedAt = d;
    }

    const oldPriceNum = event.unitPrice != null ? Number(event.unitPrice) : null;
    const newPriceNum: number | null =
      dto.unitPrice !== undefined ? dto.unitPrice : oldPriceNum;
    const sameQty = newQty === oldQty;
    const sameDate = newCreatedAt.getTime() === event.createdAt.getTime();
    const samePrice = newPriceNum === oldPriceNum || (newPriceNum == null && oldPriceNum == null);
    if (sameQty && sameDate && samePrice) {
      throw new AppError(400, 'Нет изменений');
    }

    const qtyDiff = newQty - oldQty;

    const beforeSnap = {
      qtyDelta: oldQty,
      createdAt: event.createdAt.toISOString(),
      unitPrice: oldPriceNum,
      lineTotal: event.lineTotal != null ? event.lineTotal.toString() : null,
    };

    let afterLineTotal: string | null = null;

    await prisma.$transaction(async (tx) => {
      if (qtyDiff !== 0) {
        const product = await tx.product.findUnique({
          where: { id: event.productId },
          select: { stock: true, name: true },
        });
        if (!product) throw new AppError(404, 'Товар не найден');
        const wh = Number(product.stock);
        if (qtyDiff > 0 && wh < qtyDiff) {
          throw new AppError(
            400,
            `Недостаточно товара на складе (${product.name}): нужно ещё ${qtyDiff}, доступно ${wh}`,
          );
        }
        await tx.product.update({
          where: { id: event.productId },
          data: { stock: { increment: -qtyDiff } },
        });
      }

      const unitPriceDec =
        newPriceNum != null && !Number.isNaN(newPriceNum) ? new Prisma.Decimal(newPriceNum) : null;
      const lineTotal =
        unitPriceDec != null ? unitPriceDec.mul(new Prisma.Decimal(newQty)) : null;
      if (lineTotal != null) {
        afterLineTotal = lineTotal.toString();
      }

      await tx.clientStockEvent.update({
        where: { id: eventId },
        data: {
          qtyDelta: newQty,
          createdAt: newCreatedAt,
          unitPrice: unitPriceDec,
          lineTotal,
        },
      });

      const mov =
        (await tx.inventoryMovement.findFirst({
          where: { clientStockEventId: eventId },
        })) ||
        (await tx.inventoryMovement.findFirst({
          where: {
            productId: event.productId,
            type: 'OUT',
            createdBy: event.authorId,
            quantity: event.qtyDelta,
            createdAt: {
              gte: new Date(event.createdAt.getTime() - 15_000),
              lte: new Date(event.createdAt.getTime() + 15_000),
            },
          },
          orderBy: { createdAt: 'asc' },
        }));

      if (mov) {
        await tx.inventoryMovement.update({
          where: { id: mov.id },
          data: {
            quantity: newQty,
            createdAt: newCreatedAt,
            clientStockEventId: eventId,
          },
        });
      }

      await this.replayClientStockChain(tx, clientId, event.productId);
    });

    await auditLog({
      userId: user.userId,
      action: 'OVERRIDE_UPDATE',
      entityType: 'client_stock_event',
      entityId: eventId,
      before: beforeSnap,
      after: {
        qtyDelta: newQty,
        createdAt: newCreatedAt.toISOString(),
        unitPrice: newPriceNum,
        lineTotal: afterLineTotal,
        reason: dto.reason ?? null,
      },
      reason: dto.reason,
    });

    return this.getStock(clientId, user, { historyLimit: 100 });
  }

  private async getAccessibleClient(id: string, user: AuthUser) {
    const client = await prisma.client.findFirst({
      where: { id, ...clientOwnerScope(user), isArchived: false },
      select: { id: true, managerId: true, companyName: true },
    });
    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }
    return client;
  }

  async getStock(id: string, user: AuthUser, query?: { historyLimit?: number }) {
    await this.getAccessibleClient(id, user);
    const historyLimit = Math.max(1, Math.min(200, Number(query?.historyLimit ?? 50)));

    const [positions, events] = await Promise.all([
      prisma.clientStockPosition.findMany({
        where: { clientId: id, qtyTotal: { gt: 0 } },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true, salePrice: true } },
        },
        orderBy: [{ product: { name: 'asc' } }],
      }),
      prisma.clientStockEvent.findMany({
        where: { clientId: id },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          author: { select: { id: true, fullName: true } },
          sourceDeal: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: historyLimit,
      }),
    ]);

    return {
      positions: positions.map((p) => ({
        id: p.id,
        productId: p.productId,
        qtyTotal: Number(p.qtyTotal),
        product: p.product
          ? {
              id: p.product.id,
              name: p.product.name,
              sku: p.product.sku,
              unit: p.product.unit,
              salePrice: p.product.salePrice != null ? Number(p.product.salePrice) : null,
            }
          : null,
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        productId: e.productId,
        qtyDelta: Number(e.qtyDelta),
        qtyBefore: Number(e.qtyBefore),
        qtyAfter: Number(e.qtyAfter),
        unitPrice: e.unitPrice != null ? Number(e.unitPrice) : null,
        lineTotal: e.lineTotal != null ? Number(e.lineTotal) : null,
        comment: e.comment,
        createdAt: e.createdAt,
        product: e.product,
        author: e.author,
        sourceDeal: e.sourceDeal,
      })),
      totals: {
        distinctProducts: positions.length,
        totalQty: positions.reduce((sum, p) => sum + Number(p.qtyTotal), 0),
      },
    };
  }

  async addStock(id: string, dto: AddClientStockDto, user: AuthUser) {
    const client = await this.getAccessibleClient(id, user);

    const result = await prisma.$transaction(async (tx) => {
      const touchedProductIds = new Set<string>();
      const eventIds: string[] = [];

      for (const item of dto.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, isActive: true, salePrice: true, stock: true },
        });
        if (!product || !product.isActive) {
          throw new AppError(404, 'Товар не найден или неактивен');
        }
        const qty = Number(item.qty);
        const warehouseStock = Number(product.stock ?? 0);
        if (warehouseStock < qty) {
          throw new AppError(400, `Недостаточно товара на складе: ${product.name}`);
        }
        const before = await tx.clientStockPosition.findUnique({
          where: { clientId_productId: { clientId: id, productId: item.productId } },
          select: { id: true, qtyTotal: true },
        });
        const qtyBefore = Number(before?.qtyTotal ?? 0);
        const qtyAfter = qtyBefore + qty;
        const unitPrice = item.price ?? (product.salePrice != null ? Number(product.salePrice) : undefined);
        const lineTotal = unitPrice != null ? qty * unitPrice : undefined;

        const dec = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: qty } },
          data: { stock: { decrement: qty } },
        });
        if (dec.count === 0) {
          throw new AppError(400, `Недостаточно товара на складе: ${product.name}`);
        }

        await tx.clientStockPosition.upsert({
          where: { clientId_productId: { clientId: id, productId: item.productId } },
          create: { clientId: id, productId: item.productId, qtyTotal: qtyAfter },
          update: { qtyTotal: qtyAfter },
        });
        const ev = await tx.clientStockEvent.create({
          data: {
            clientId: id,
            productId: item.productId,
            type: 'ADD',
            qtyDelta: qty,
            qtyBefore,
            qtyAfter,
            authorId: user.userId,
            comment: item.comment?.trim() || null,
            unitPrice: unitPrice ?? null,
            lineTotal: lineTotal ?? null,
          },
          select: { id: true },
        });
        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            type: 'OUT',
            quantity: qty,
            clientStockEventId: ev.id,
            note: `Перенос в товары клиента: ${client.companyName}${item.comment?.trim() ? ` (${item.comment.trim()})` : ''}`,
            createdBy: user.userId,
          },
        });
        eventIds.push(ev.id);
        touchedProductIds.add(item.productId);
      }

      return { touchedProductIds: [...touchedProductIds], eventIds };
    });

    await auditLog({
      userId: user.userId,
      action: 'UPDATE_CLIENT',
      entityType: 'client',
      entityId: id,
      after: { stockEventIds: result.eventIds, itemsCount: dto.items.length },
    });

    return this.getStock(id, user, { historyLimit: 50 });
  }

  private buildDealTitle(title?: string): string {
    return title?.trim() || `Отгрузка со склада клиента от ${new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' })}`;
  }

  async sendStockPartial(id: string, dto: SendClientStockPartialDto, user: AuthUser) {
    const client = await this.getAccessibleClient(id, user);

    const created = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const prepared: Array<{ productId: string; qty: number; price: number; requestComment?: string }> = [];

      for (const item of dto.items) {
        const pos = await tx.clientStockPosition.findUnique({
          where: { clientId_productId: { clientId: id, productId: item.productId } },
          include: { product: { select: { id: true, salePrice: true, isActive: true } } },
        });
        if (!pos || Number(pos.qtyTotal) <= 0) {
          throw new AppError(400, 'По одной из позиций остаток отсутствует');
        }
        if (!pos.product?.isActive) {
          throw new AppError(400, 'По одной из позиций товар неактивен');
        }
        const qty = Number(item.qty);
        const available = Number(pos.qtyTotal);
        if (qty > available) {
          throw new AppError(400, 'Нельзя отправить больше, чем доступный остаток');
        }
        const price = item.price ?? (pos.product.salePrice != null ? Number(pos.product.salePrice) : 0);
        if (price <= 0) {
          throw new AppError(400, 'Укажите цену для отправляемых позиций');
        }
        prepared.push({ productId: item.productId, qty, price, requestComment: item.requestComment });
        totalAmount += qty * price;
      }

      const deal = await tx.deal.create({
        data: {
          title: this.buildDealTitle(dto.title),
          status: 'IN_PROGRESS',
          amount: totalAmount,
          discount: 0,
          clientId: id,
          managerId: user.userId,
          paymentType: 'FULL',
          paidAmount: 0,
          paymentStatus: 'UNPAID',
          isSessionDeal: false,
          deliveryType: (dto.deliveryType as DeliveryType | undefined) ?? 'SELF_PICKUP',
          vehicleNumber: dto.vehicleNumber?.trim() || null,
          vehicleType: dto.vehicleType?.trim() || null,
          deliveryComment: dto.deliveryComment?.trim() || null,
        },
        select: { id: true, title: true, status: true, amount: true, clientId: true, createdAt: true },
      });

      for (const item of prepared) {
        const before = await tx.clientStockPosition.findUniqueOrThrow({
          where: { clientId_productId: { clientId: id, productId: item.productId } },
          select: { qtyTotal: true },
        });
        const qtyBefore = Number(before.qtyTotal);
        const qtyAfter = Math.max(0, qtyBefore - item.qty);
        await tx.clientStockPosition.update({
          where: { clientId_productId: { clientId: id, productId: item.productId } },
          data: { qtyTotal: qtyAfter },
        });
        await tx.dealItem.create({
          data: {
            dealId: deal.id,
            productId: item.productId,
            requestedQty: item.qty,
            price: item.price,
            lineTotal: item.qty * item.price,
            sourceOpType: 'CLIENT_STOCK',
            requestComment: item.requestComment?.trim() || null,
          },
        });
        await tx.clientStockEvent.create({
          data: {
            clientId: id,
            productId: item.productId,
            type: 'RESERVE_TO_DEAL',
            qtyDelta: -item.qty,
            qtyBefore,
            qtyAfter,
            authorId: user.userId,
            sourceDealId: deal.id,
            comment: item.requestComment?.trim() || 'Отправлено в работу',
            unitPrice: item.price,
            lineTotal: item.qty * item.price,
          },
        });
      }

      if (client.managerId !== user.userId) {
        await tx.client.update({
          where: { id },
          data: { managerId: user.userId },
        });
      }

      return deal;
    });

    await auditLog({
      userId: user.userId,
      action: 'CREATE',
      entityType: 'deal',
      entityId: created.id,
      after: { title: created.title, status: created.status, amount: Number(created.amount), clientId: created.clientId },
    });

    return created;
  }

  async sendStockAll(id: string, dto: SendClientStockAllDto, user: AuthUser) {
    await this.getAccessibleClient(id, user);
    const positions = await prisma.clientStockPosition.findMany({
      where: { clientId: id, qtyTotal: { gt: 0 } },
      include: { product: { select: { salePrice: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (positions.length === 0) {
      throw new AppError(400, 'Нет остатков для отправки');
    }
    const payload: SendClientStockPartialDto = {
      ...dto,
      items: positions.map((p) => ({
        productId: p.productId,
        qty: Number(p.qtyTotal),
        price: p.product.salePrice != null ? Number(p.product.salePrice) : undefined,
        requestComment: 'Отправлено целиком',
      })),
    };
    return this.sendStockPartial(id, payload, user);
  }

  async getHistory(id: string, user: AuthUser) {
    // Verify access
    const client = await prisma.client.findFirst({
      where: { id, ...clientOwnerScope(user) },
    });

    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    return prisma.auditLog.findMany({
      where: { entityType: 'client', entityId: id },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPayments(id: string, user: AuthUser) {
    const client = await prisma.client.findFirst({
      where: { id, ...clientOwnerScope(user) },
    });

    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    return prisma.payment.findMany({
      where: { clientId: id },
      include: {
        deal: { select: { id: true, title: true } },
        creator: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  async getAnalytics(id: string, user: AuthUser, periodDays: number = 30) {
    const client = await prisma.client.findFirst({
      where: { id, ...clientOwnerScope(user) },
    });

    if (!client) {
      throw new AppError(404, 'Клиент не найден');
    }

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - periodDays);

    // All deals for this client (not archived)
    const allDeals = await prisma.deal.findMany({
      where: { clientId: id, isArchived: false },
      select: {
        id: true,
        status: true,
        amount: true,
        paidAmount: true,
        createdAt: true,
      },
    });

    // Metrics: debt from active pipeline; revenue only from CLOSED (deal_items line totals)
    const nonCanceled = allDeals.filter((d) => d.status !== 'CANCELED' && d.status !== 'REJECTED');
    const totalDeals = allDeals.length;
    const completedDeals = allDeals.filter((d) => d.status === 'CLOSED').length;
    const canceledDeals = allDeals.filter((d) => d.status === 'CANCELED').length;
    const dealsDebt = nonCanceled.reduce((s, d) => s + Math.max(0, Number(d.amount) - Number(d.paidAmount)), 0);

    const [revAgg, revByDayRaw, topProductsRaw, stockRevAgg, stockRevByDayRaw, stockTopProductsRaw, stockDebtAllRaw] = await Promise.all([
      prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`
        SELECT COALESCE(SUM(${SQL_ANALYTICS_LINE_REVENUE_DI}), 0)::text as total
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE d.client_id = ${id}
          AND ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${periodStart}`,
      ),
      prisma.$queryRaw<{ day: Date; amount: string }[]>(
        Prisma.sql`
        SELECT ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT} as day,
               SUM(${SQL_ANALYTICS_LINE_REVENUE_DI})::text as amount
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE d.client_id = ${id}
          AND ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${periodStart}
        GROUP BY ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT}
        ORDER BY day ASC`,
      ),
      prisma.$queryRaw<{ product_id: string; total_qty: string }[]>(
        Prisma.sql`
        SELECT di.product_id, COALESCE(SUM(di.requested_qty), 0)::text as total_qty
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE d.client_id = ${id}
          AND ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
          AND ${SQL_EFFECTIVE_REVENUE_ITEM_TS} >= ${periodStart}
          AND di.requested_qty IS NOT NULL
        GROUP BY di.product_id
        ORDER BY SUM(di.requested_qty) DESC
        LIMIT 5`,
      ),
      prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`
        SELECT COALESCE(SUM(${SQL_CLIENT_STOCK_ADD_LINE}), 0)::text as total
        FROM client_stock_events cse
        WHERE cse.client_id = ${id}
          AND cse.type = 'ADD'
          AND cse.created_at >= ${periodStart}`,
      ),
      prisma.$queryRaw<ClientStockRevenueRow[]>(
        Prisma.sql`
        SELECT DATE((cse.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent') as day,
               COALESCE(SUM(${SQL_CLIENT_STOCK_ADD_LINE}), 0)::text as amount
        FROM client_stock_events cse
        WHERE cse.client_id = ${id}
          AND cse.type = 'ADD'
          AND cse.created_at >= ${periodStart}
        GROUP BY day
        ORDER BY day ASC`,
      ),
      prisma.$queryRaw<ClientStockTopProductRow[]>(
        Prisma.sql`
        SELECT cse.product_id, COALESCE(SUM(cse.qty_delta), 0)::text as total_qty
        FROM client_stock_events cse
        WHERE cse.client_id = ${id}
          AND cse.type = 'ADD'
          AND cse.created_at >= ${periodStart}
        GROUP BY cse.product_id
        ORDER BY SUM(cse.qty_delta) DESC
        LIMIT 5`,
      ),
      prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`
        SELECT COALESCE(SUM(${SQL_CLIENT_STOCK_ADD_LINE}), 0)::text as total
        FROM client_stock_events cse
        WHERE cse.client_id = ${id}
          AND cse.type = 'ADD'`,
      ),
    ]);

    const totalSpent = (revAgg[0] ? Number(revAgg[0].total) : 0) + (stockRevAgg[0] ? Number(stockRevAgg[0].total) : 0);
    const stockDebtAll = stockDebtAllRaw[0] ? Number(stockDebtAllRaw[0].total) : 0;
    const currentDebt = dealsDebt + stockDebtAll;

    // Last payment
    const lastPayment = await prisma.payment.findFirst({
      where: { clientId: id },
      orderBy: { paidAt: 'desc' },
      select: { paidAt: true },
    });

    const revenueByDayMap = new Map<string, number>();
    for (const r of revByDayRaw) {
      const day = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
      revenueByDayMap.set(day, (revenueByDayMap.get(day) ?? 0) + Number(r.amount));
    }
    for (const r of stockRevByDayRaw) {
      const day = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
      revenueByDayMap.set(day, (revenueByDayMap.get(day) ?? 0) + Number(r.amount));
    }
    const revenueByDayArr = [...revenueByDayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));

    const topQtyByProduct = new Map<string, number>();
    for (const tp of topProductsRaw) {
      topQtyByProduct.set(tp.product_id, (topQtyByProduct.get(tp.product_id) ?? 0) + Number(tp.total_qty));
    }
    for (const tp of stockTopProductsRaw) {
      topQtyByProduct.set(tp.product_id, (topQtyByProduct.get(tp.product_id) ?? 0) + Number(tp.total_qty));
    }
    const productIds = [...topQtyByProduct.keys()];
    const products = productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    const topProductsResult = [...topQtyByProduct.entries()]
      .map(([productId, totalQuantity]) => ({
        productId,
        productName: productMap.get(productId) || 'Неизвестный',
        totalQuantity,
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 5);

    // Recent payments
    const recentPayments = await prisma.payment.findMany({
      where: { clientId: id },
      include: {
        deal: { select: { id: true, title: true } },
        creator: { select: { id: true, fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 10,
    });

    return {
      metrics: {
        totalDeals,
        completedDeals,
        canceledDeals,
        totalSpent,
        currentDebt,
        lastPaymentDate: lastPayment?.paidAt || null,
      },
      revenueByDay: revenueByDayArr,
      topProducts: topProductsResult,
      recentPayments,
    };
  }
}

export const clientsService = new ClientsService();
