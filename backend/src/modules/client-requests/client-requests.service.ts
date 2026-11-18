import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

export const REQUEST_KINDS = ['PRODUCT', 'OTHER'] as const;
export const REQUEST_STATUSES = ['NEW', 'IN_PROGRESS', 'DONE', 'REJECTED'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const CLOSED: RequestStatus[] = ['DONE', 'REJECTED'];

export type ListFilter = {
  status?: RequestStatus | 'OPEN';
  kind?: RequestKind;
  clientId?: string;
  productId?: string;
  authorId?: string;
};

export type CreateInput = {
  clientId: string;
  kind: RequestKind;
  productId?: string | null;
  productName?: string | null;
  quantity?: number | null;
  unit?: string | null;
  description?: string | null;
  dueDate?: string | null;
};

export type UpdateInput = Partial<CreateInput> & {
  status?: RequestStatus;
  resolution?: string | null;
};

const include = {
  client: {
    select: {
      id: true,
      companyName: true,
      contactName: true,
      phone: true,
      manager: { select: { id: true, fullName: true } },
    },
  },
  product: { select: { id: true, name: true, sku: true, unit: true, stock: true } },
  author: { select: { id: true, fullName: true } },
  closedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ClientRequestInclude;

type Row = Prisma.ClientRequestGetPayload<{ include: typeof include }>;

function serialize(r: Row) {
  return {
    ...r,
    quantity: r.quantity == null ? null : Number(r.quantity),
    product: r.product ? { ...r.product, stock: Number(r.product.stock) } : null,
  };
}

/** Товар из каталога или своё название — хотя бы одно; для «другое» обязательно описание. */
function checkShape(kind: RequestKind, productId: string | null | undefined, productName: string | null | undefined, description: string | null | undefined) {
  if (kind === 'PRODUCT' && !productId && !productName?.trim()) {
    throw new AppError(400, 'Выберите товар или напишите его название');
  }
  if (kind === 'OTHER' && !description?.trim()) {
    throw new AppError(400, 'Опишите, что хочет клиент');
  }
}

export const clientRequestsService = {
  async list(filter: ListFilter) {
    const where: Prisma.ClientRequestWhereInput = {};
    if (filter.status === 'OPEN') where.status = { notIn: CLOSED };
    else if (filter.status) where.status = filter.status;
    if (filter.kind) where.kind = filter.kind;
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.productId) where.productId = filter.productId;
    if (filter.authorId) where.authorId = filter.authorId;

    const rows = await prisma.clientRequest.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return rows.map(serialize);
  },

  /** Что чаще всего просят: открытые запросы на товары, сгруппированные по товару или названию. */
  async summary() {
    const [byStatus, open] = await Promise.all([
      prisma.clientRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.clientRequest.findMany({
        where: { kind: 'PRODUCT', status: { notIn: CLOSED } },
        select: {
          clientId: true,
          productId: true,
          productName: true,
          quantity: true,
          unit: true,
          product: { select: { name: true, unit: true, stock: true } },
        },
      }),
    ]);

    const groups = new Map<string, { key: string; productId: string | null; name: string; unit: string | null; stock: number | null; requests: number; clients: Set<string>; quantity: number }>();
    for (const r of open) {
      const name = r.product?.name ?? r.productName?.trim() ?? '—';
      const key = r.productId ?? `name:${name.toLowerCase()}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          productId: r.productId,
          name,
          unit: r.product?.unit ?? r.unit ?? null,
          stock: r.product ? Number(r.product.stock) : null,
          requests: 0,
          clients: new Set(),
          quantity: 0,
        };
        groups.set(key, g);
      }
      g.requests += 1;
      g.clients.add(r.clientId);
      if (r.quantity != null) g.quantity += Number(r.quantity);
    }

    const counts: Record<string, number> = {};
    for (const s of byStatus) counts[s.status] = s._count._all;

    return {
      counts,
      topProducts: [...groups.values()]
        .map(({ clients, ...g }) => ({ ...g, clients: clients.size }))
        .sort((a, b) => b.clients - a.clients || b.requests - a.requests)
        .slice(0, 15),
    };
  },

  async create(input: CreateInput, userId: string) {
    checkShape(input.kind, input.productId, input.productName, input.description);
    const row = await prisma.clientRequest.create({
      data: {
        clientId: input.clientId,
        kind: input.kind,
        productId: input.kind === 'PRODUCT' ? input.productId ?? null : null,
        productName: input.kind === 'PRODUCT' && !input.productId ? input.productName?.trim() || null : null,
        quantity: input.kind === 'PRODUCT' ? input.quantity ?? null : null,
        unit: input.kind === 'PRODUCT' ? input.unit?.trim() || null : null,
        description: input.description?.trim() || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        authorId: userId,
      },
      include,
    });
    return serialize(row);
  },

  async update(id: string, input: UpdateInput, userId: string) {
    const current = await prisma.clientRequest.findUnique({ where: { id } });
    if (!current) throw new AppError(404, 'Запрос не найден');

    const kind = (input.kind ?? current.kind) as RequestKind;
    const productId = input.productId !== undefined ? input.productId : current.productId;
    const productName = input.productName !== undefined ? input.productName : current.productName;
    const description = input.description !== undefined ? input.description : current.description;
    checkShape(kind, productId, productName, description);

    const data: Prisma.ClientRequestUncheckedUpdateInput = {};
    if (input.clientId !== undefined) data.clientId = input.clientId;
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.productId !== undefined || input.productName !== undefined || input.kind !== undefined) {
      data.productId = kind === 'PRODUCT' ? productId ?? null : null;
      data.productName = kind === 'PRODUCT' && !productId ? productName?.trim() || null : null;
    }
    if (input.quantity !== undefined) data.quantity = input.quantity;
    if (input.unit !== undefined) data.unit = input.unit?.trim() || null;
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (input.resolution !== undefined) data.resolution = input.resolution?.trim() || null;
    if (input.status !== undefined && input.status !== current.status) {
      data.status = input.status;
      const closing = CLOSED.includes(input.status);
      data.closedAt = closing ? new Date() : null;
      data.closedById = closing ? userId : null;
    }

    const row = await prisma.clientRequest.update({ where: { id }, data, include });
    return serialize(row);
  },

  async remove(id: string, userId: string, isAdmin: boolean) {
    const current = await prisma.clientRequest.findUnique({ where: { id }, select: { authorId: true } });
    if (!current) throw new AppError(404, 'Запрос не найден');
    if (!isAdmin && current.authorId !== userId) {
      throw new AppError(403, 'Удалить может только автор или администратор');
    }
    await prisma.clientRequest.delete({ where: { id } });
  },

  /** Клиенты и товары для выбора в форме — ВЭД не обязательно видит раздел «Клиенты». */
  async options(q: string) {
    const term = q.trim();
    const clients = await prisma.client.findMany({
      where: {
        isArchived: false,
        ...(term
          ? {
              OR: [
                { companyName: { contains: term, mode: 'insensitive' } },
                { contactName: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } },
              ],
            }
          : {}),
      },
      select: { id: true, companyName: true, contactName: true, manager: { select: { fullName: true } } },
      orderBy: { companyName: 'asc' },
      take: 30,
    });
    return clients;
  },

  async products() {
    const rows = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, unit: true, stock: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((p) => ({ ...p, stock: Number(p.stock) }));
  },
};
