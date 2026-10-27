import { DealStatus, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

/** Товар уже у клиента: отгружен, едет или сделка закрыта. */
const PURCHASED_STATUSES: DealStatus[] = ['SHIPPED', 'IN_DELIVERY', 'CLOSED'];

export type LastContactSource = 'notes' | 'call' | 'client_note' | 'feedback';

export type LastContact = {
  source: LastContactSource;
  at: Date;
  userId: string | null;
  userName: string | null;
  text: string | null;
};

type CreateFeedbackInput = {
  productId: string;
  clientId: string;
  reached: boolean;
  rating?: number | null;
  comment?: string | null;
  arrivalAt?: string | null;
};

/**
 * Последний контакт с каждым клиентом из всех мест, где менеджеры его фиксируют:
 * заметки обзвонов, состоявшиеся звонки телефонии, заметки в карточке клиента и отзывы о товаре.
 */
async function lastContacts(clientIds: string[]): Promise<Map<string, LastContact>> {
  const result = new Map<string, LastContact>();
  if (clientIds.length === 0) return result;

  // DISTINCT ON берёт по одной свежей записи на клиента прямо в базе: звонков и заметок
  // у клиента бывают сотни, тянуть их все ради одной строки незачем.
  type Row = { client_id: string; at: Date; user_id: string | null; user_name: string | null; text: string | null };
  const [notes, calls, clientNotes, feedback] = await Promise.all([
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT DISTINCT ON (n.client_id) n.client_id, n.last_call_at AS at, u.id AS user_id, u.full_name AS user_name,
        CASE WHEN n.call_result = 'NO_ANSWER' THEN 'Не дозвонился. ' || n.comment ELSE n.comment END AS text
      FROM notes_board_rows n JOIN users u ON u.id = n.author_id
      WHERE n.client_id = ANY(${clientIds}::text[])
      ORDER BY n.client_id, n.last_call_at DESC`),
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT DISTINCT ON (c.client_id) c.client_id, c.started_at AS at, u.id AS user_id, u.full_name AS user_name,
        (CASE WHEN c.direction = 'INBOUND' THEN 'Входящий звонок' ELSE 'Исходящий звонок' END)
          || CASE WHEN c.duration_sec > 0 THEN ', ' || GREATEST(1, ROUND(c.duration_sec / 60.0))::int || ' мин' ELSE '' END AS text
      FROM call_sessions c JOIN users u ON u.id = c.manager_user_id
      WHERE c.client_id = ANY(${clientIds}::text[]) AND c.answered_at IS NOT NULL
      ORDER BY c.client_id, c.started_at DESC`),
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT DISTINCT ON (n.client_id) n.client_id, n.created_at AS at, u.id AS user_id, u.full_name AS user_name, n.content AS text
      FROM client_notes n JOIN users u ON u.id = n.user_id
      WHERE n.client_id = ANY(${clientIds}::text[]) AND n.deleted_at IS NULL
      ORDER BY n.client_id, n.created_at DESC`),
    prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT DISTINCT ON (f.client_id) f.client_id, f.created_at AS at, u.id AS user_id, u.full_name AS user_name,
        (CASE WHEN f.reached THEN 'Отзыв о «' || p.name || '»: ' || f.rating || '/5'
          ELSE 'Не дозвонился (отзыв о «' || p.name || '»)' END)
          || CASE WHEN f.comment IS NOT NULL THEN '. ' || f.comment ELSE '' END AS text
      FROM product_feedback f JOIN users u ON u.id = f.author_id JOIN products p ON p.id = f.product_id
      WHERE f.client_id = ANY(${clientIds}::text[])
      ORDER BY f.client_id, f.created_at DESC`),
  ]);

  const offer = (source: LastContactSource, rows: Row[]) => {
    for (const r of rows) {
      const current = result.get(r.client_id);
      if (current && current.at >= r.at) continue;
      result.set(r.client_id, { source, at: r.at, userId: r.user_id, userName: r.user_name, text: r.text });
    }
  };
  offer('notes', notes);
  offer('call', calls);
  offer('client_note', clientNotes);
  offer('feedback', feedback);
  return result;
}

export const productFeedbackService = {
  /** Товары с приходами (движение IN без сделки — поставка, а не возврат), свежие приходы сверху. */
  async listProductsWithArrivals() {
    const arrivals = await prisma.inventoryMovement.groupBy({
      by: ['productId'],
      where: { type: 'IN', dealId: null },
      _max: { createdAt: true },
    });
    const lastArrival = new Map(arrivals.map((a) => [a.productId, a._max.createdAt]));
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, unit: true, category: true, format: true },
    });
    return products
      .map((p) => ({ ...p, lastArrivalAt: lastArrival.get(p.id) ?? null }))
      .sort((a, b) => {
        if (a.lastArrivalAt && b.lastArrivalAt) return b.lastArrivalAt.getTime() - a.lastArrivalAt.getTime();
        if (a.lastArrivalAt || b.lastArrivalAt) return a.lastArrivalAt ? -1 : 1;
        return a.name.localeCompare(b.name, 'ru');
      });
  },

  async listArrivals(productId: string) {
    const rows = await prisma.inventoryMovement.findMany({
      where: { productId, type: 'IN', dealId: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, createdAt: true, quantity: true, note: true },
    });
    return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  },

  /** Клиенты, купившие товар с даты прихода до сегодня: телефон, что купили, последний контакт и отзывы. */
  async listClients(productId: string, from: Date) {
    const items = await prisma.dealItem.findMany({
      where: {
        productId,
        deal: { status: { in: PURCHASED_STATUSES }, isArchived: false, createdAt: { gte: from } },
      },
      select: {
        requestedQty: true,
        deal: {
          select: {
            id: true, title: true, createdAt: true, closedAt: true,
            manager: { select: { id: true, fullName: true } },
            client: {
              select: {
                id: true, companyName: true, contactName: true, phone: true, isSvip: true,
                manager: { select: { id: true, fullName: true } },
              },
            },
          },
        },
      },
    });

    type ClientRow = {
      clientId: string;
      companyName: string;
      contactName: string;
      phone: string | null;
      isSvip: boolean;
      clientManager: { id: string; fullName: string };
      qty: number;
      deals: { id: string; title: string; at: Date; managerName: string }[];
      lastPurchaseAt: Date;
    };
    const byClient = new Map<string, ClientRow>();
    for (const item of items) {
      const { deal } = item;
      const at = deal.closedAt ?? deal.createdAt;
      const row = byClient.get(deal.client.id) ?? {
        clientId: deal.client.id,
        companyName: deal.client.companyName,
        contactName: deal.client.contactName,
        phone: deal.client.phone,
        isSvip: deal.client.isSvip,
        clientManager: deal.client.manager,
        qty: 0,
        deals: [],
        lastPurchaseAt: at,
      };
      row.qty += Number(item.requestedQty ?? 0);
      if (!row.deals.some((d) => d.id === deal.id)) {
        row.deals.push({ id: deal.id, title: deal.title, at, managerName: deal.manager.fullName });
      }
      if (at > row.lastPurchaseAt) row.lastPurchaseAt = at;
      byClient.set(deal.client.id, row);
    }

    const clientIds = [...byClient.keys()];
    const [contacts, feedback] = await Promise.all([
      lastContacts(clientIds),
      clientIds.length
        ? prisma.productFeedback.findMany({
          where: { productId, clientId: { in: clientIds }, createdAt: { gte: from } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, clientId: true, reached: true, rating: true, comment: true, createdAt: true,
            author: { select: { id: true, fullName: true } },
          },
        })
        : Promise.resolve([]),
    ]);

    return [...byClient.values()]
      .map((row) => ({
        ...row,
        deals: row.deals.sort((a, b) => b.at.getTime() - a.at.getTime()),
        lastContact: contacts.get(row.clientId) ?? null,
        feedback: feedback.filter((f) => f.clientId === row.clientId),
      }))
      .sort((a, b) => b.lastPurchaseAt.getTime() - a.lastPurchaseAt.getTime());
  },

  async create(input: CreateFeedbackInput, authorId: string) {
    const [product, client] = await Promise.all([
      prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } }),
      prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } }),
    ]);
    if (!product) throw new AppError(404, 'Товар не найден');
    if (!client) throw new AppError(404, 'Клиент не найден');
    return prisma.productFeedback.create({
      data: {
        productId: input.productId,
        clientId: input.clientId,
        authorId,
        reached: input.reached,
        rating: input.reached ? input.rating ?? null : null,
        comment: input.comment?.trim() || null,
        arrivalAt: input.arrivalAt ? new Date(input.arrivalAt) : null,
      },
      select: {
        id: true, clientId: true, reached: true, rating: true, comment: true, createdAt: true,
        author: { select: { id: true, fullName: true } },
      },
    });
  },
};
