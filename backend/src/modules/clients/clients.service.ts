import { DealStatus, Client, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser, clientOwnerScope } from '../../lib/scope';
import { CreateClientDto, UpdateClientDto } from './clients.dto';

function clientAuditSnapshot(c: Client) {
  return {
    id: c.id,
    companyName: c.companyName,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    address: c.address,
    notes: c.notes,
    inn: c.inn,
    bankName: c.bankName,
    bankAccount: c.bankAccount,
    mfo: c.mfo,
    vatRegCode: c.vatRegCode,
    oked: c.oked,
    managerId: c.managerId,
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

    const [noteRows, dealsAgg, paysAgg] = await Promise.all([
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
    ]);

    const noteByClient = new Map(noteRows.map((n) => [n.clientId, n]));
    const dealMaxByClient = new Map(
      dealsAgg.map((d) => [d.clientId, d._max.createdAt?.getTime() ?? 0]),
    );
    const payMaxByClient = new Map(
      paysAgg.map((p) => [p.clientId, p._max.paidAt?.getTime() ?? 0]),
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
      return {
        ...client,
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

    // Metrics (exclude CANCELED from totals)
    const nonCanceled = allDeals.filter((d) => d.status !== 'CANCELED');
    const totalDeals = allDeals.length;
    const completedDeals = allDeals.filter((d) => d.status === 'CLOSED').length;
    const canceledDeals = allDeals.filter((d) => d.status === 'CANCELED').length;
    const totalSpent = nonCanceled.reduce((s, d) => s + Number(d.paidAmount), 0);
    const currentDebt = nonCanceled.reduce((s, d) => s + Math.max(0, Number(d.amount) - Number(d.paidAmount)), 0);

    // Last payment
    const lastPayment = await prisma.payment.findFirst({
      where: { clientId: id },
      orderBy: { paidAt: 'desc' },
      select: { paidAt: true },
    });

    // Revenue by day (within period, exclude CANCELED)
    const periodDeals = nonCanceled.filter((d) => d.createdAt >= periodStart);
    const revenueByDay: Record<string, number> = {};
    for (const deal of periodDeals) {
      const day = deal.createdAt.toISOString().slice(0, 10);
      revenueByDay[day] = (revenueByDay[day] || 0) + Number(deal.amount);
    }
    const revenueByDayArr = Object.entries(revenueByDay)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top products (from non-CANCELED deals)
    const nonCanceledIds = nonCanceled.map((d) => d.id);
    const topProducts = nonCanceledIds.length > 0
      ? await prisma.dealItem.groupBy({
          by: ['productId'],
          where: { dealId: { in: nonCanceledIds }, requestedQty: { not: null } },
          _sum: { requestedQty: true },
          orderBy: { _sum: { requestedQty: 'desc' } },
          take: 5,
        })
      : [];

    // Fetch product names for top products
    const productIds = topProducts.map((tp) => tp.productId);
    const products = productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    const topProductsResult = topProducts.map((tp) => ({
      productId: tp.productId,
      productName: productMap.get(tp.productId) || 'Неизвестный',
      totalQuantity: tp._sum?.requestedQty ? Number(tp._sum.requestedQty) : 0,
    }));

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
