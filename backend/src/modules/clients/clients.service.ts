import { DealStatus, Client, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { AuthUser, clientOwnerScope } from '../../lib/scope';
import { CreateClientDto, UpdateClientDto } from './clients.dto';
import {
  SQL_DEALS_CLOSED_REVENUE_FILTER,
  SQL_EFFECTIVE_ITEM_DATE_TASHKENT,
  SQL_EFFECTIVE_ITEM_TS,
  SQL_LINE_REVENUE_DI,
} from '../../lib/analytics';

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
    portraitProfile: c.portraitProfile,
    portraitGoals: c.portraitGoals,
    portraitPains: c.portraitPains,
    portraitFears: c.portraitFears,
    portraitObjections: c.portraitObjections,
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
    const currentDebt = nonCanceled.reduce((s, d) => s + Math.max(0, Number(d.amount) - Number(d.paidAmount)), 0);

    const [revAgg, revByDayRaw, topProductsRaw] = await Promise.all([
      prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`
        SELECT COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text as total
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE d.client_id = ${id}
          AND ${SQL_DEALS_CLOSED_REVENUE_FILTER}
          AND ${SQL_EFFECTIVE_ITEM_TS} >= ${periodStart}`,
      ),
      prisma.$queryRaw<{ day: Date; amount: string }[]>(
        Prisma.sql`
        SELECT ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT} as day,
               SUM(${SQL_LINE_REVENUE_DI})::text as amount
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE d.client_id = ${id}
          AND ${SQL_DEALS_CLOSED_REVENUE_FILTER}
          AND ${SQL_EFFECTIVE_ITEM_TS} >= ${periodStart}
        GROUP BY ${SQL_EFFECTIVE_ITEM_DATE_TASHKENT}
        ORDER BY day ASC`,
      ),
      prisma.$queryRaw<{ product_id: string; total_qty: string }[]>(
        Prisma.sql`
        SELECT di.product_id, COALESCE(SUM(di.requested_qty), 0)::text as total_qty
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE d.client_id = ${id}
          AND ${SQL_DEALS_CLOSED_REVENUE_FILTER}
          AND ${SQL_EFFECTIVE_ITEM_TS} >= ${periodStart}
          AND di.requested_qty IS NOT NULL
        GROUP BY di.product_id
        ORDER BY SUM(di.requested_qty) DESC
        LIMIT 5`,
      ),
    ]);

    const totalSpent = revAgg[0] ? Number(revAgg[0].total) : 0;

    // Last payment
    const lastPayment = await prisma.payment.findFirst({
      where: { clientId: id },
      orderBy: { paidAt: 'desc' },
      select: { paidAt: true },
    });

    const revenueByDayArr = revByDayRaw.map((r) => ({
      date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      amount: Number(r.amount),
    }));

    const productIds = topProductsRaw.map((tp) => tp.product_id);
    const products = productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    const topProductsResult = topProductsRaw.map((tp) => ({
      productId: tp.product_id,
      productName: productMap.get(tp.product_id) || 'Неизвестный',
      totalQuantity: Number(tp.total_qty),
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
