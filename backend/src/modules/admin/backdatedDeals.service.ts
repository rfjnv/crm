import { PaymentMethod, Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { LAMINATION_CATEGORY, isRollTrackedProduct } from '../../lib/lamination';

/**
 * SUPER_ADMIN: сделки задним числом по отпускной ведомости — по одной сделке на каждую
 * дату. Склад списывается датой сделки (17:00 по Ташкенту), а у товаров, по которым после
 * этого уже были движения, пересчитываются остатки «до/после» в истории — иначе история
 * склада показывала бы остатки, которых на тот момент не было.
 *
 * Рулоны ламинации, если их не указали: медианный вес рулона из прошлых списаний этого
 * товара, а для ширин без истории — пропорционально ширине по той же отделке.
 */

const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'PAYME', 'QR', 'CLICK', 'TERMINAL', 'INSTALLMENT'] as const;

export const backdatedDealsDto = z.object({
  clientId: z.string().uuid(),
  managerId: z.string().uuid(),
  /** CLOSED — закрыта и списана со склада; NEW — открыта, склад не трогаем. */
  status: z.enum(['CLOSED', 'NEW']).default('CLOSED'),
  paymentMethod: z.enum(PAYMENT_METHODS).default('CASH'),
  /** PAID — по каждой сделке создаётся оплата на всю сумму датой сделки. */
  paymentState: z.enum(['UNPAID', 'PAID']).default('UNPAID'),
  deductStock: z.boolean().default(true),
  reason: z.string().trim().min(3, 'Укажите причину (мин. 3 символа)'),
  items: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'),
    productId: z.string().uuid(),
    qty: z.number().positive(),
    price: z.number().min(0),
    /** Пусто — посчитаем по среднему весу рулона. */
    rollCount: z.number().positive().nullable().optional(),
  })).min(1, 'Добавьте хотя бы одну позицию').max(300),
});
export type BackdatedDealsDto = z.infer<typeof backdatedDealsDto>;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const widthOf = (sku: string) => Number((sku.match(/(\d+)/) || [])[1]);
const finishOf = (sku: string) => (/матт/i.test(sku) ? 'матт' : /силвер|голд|голог|софтач/i.test(sku) ? 'металл' : 'глянец');

/** Дата ведомости → момент по Ташкенту (UTC+5). */
const tashkentAt = (date: string, hour: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 5, 0, 0));
};
const ruDate = (date: string) => date.split('-').reverse().join('.');

type Db = Prisma.TransactionClient | typeof prisma;

async function rollWeightEstimator(db: Db) {
  const hist = await db.$queryRaw<{ sku: string; kpr: number }[]>`
    SELECT p.sku, (m.quantity / m.roll_quantity)::float AS kpr
    FROM inventory_movements m JOIN products p ON p.id = m.product_id
    WHERE m.type = 'OUT' AND m.roll_quantity > 0 AND m.quantity > 0 AND p.category = ${LAMINATION_CATEGORY}`;
  const bySku = new Map<string, number[]>();
  for (const h of hist) (bySku.get(h.sku) ?? bySku.set(h.sku, []).get(h.sku)!).push(Number(h.kpr));
  const perCm = new Map<string, number[]>();
  for (const [sku, a] of bySku) {
    const w = widthOf(sku);
    if (!w) continue;
    const f = finishOf(sku);
    (perCm.get(f) ?? perCm.set(f, []).get(f)!).push(median(a) / w);
  }
  return (sku: string): { kg: number; how: string } | null => {
    const a = bySku.get(sku);
    if (a && a.length >= 2) return { kg: median(a), how: `средний вес по ${a.length} списаниям` };
    const k = perCm.get(finishOf(sku));
    const w = widthOf(sku);
    if (!k || !w) return null;
    return { kg: median(k) * w, how: `по ширине ${w} см (истории нет)` };
  };
}

/** Пересчёт stock/roll «до/после» у движений товара начиная с момента `from`. */
async function rechainFrom(tx: Prisma.TransactionClient, productId: string, from: Date) {
  const base = await tx.inventoryMovement.findFirst({
    where: { productId, createdAt: { lt: from } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const moves = await tx.inventoryMovement.findMany({
    where: { productId, createdAt: { gte: from } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!moves.length) return;
  // Старые движения без снимка остатка — точки отсчёта нет, историю не трогаем.
  if (base && base.stockAfter == null) return;
  // Без предыдущих движений берём «до» первого движения как есть.
  let stock = base ? Number(base.stockAfter) : Number(moves[0].stockBefore ?? 0);
  let rolls: number | null = base
    ? (base.rollStockAfter != null ? Number(base.rollStockAfter) : null)
    : (moves[0].rollStockBefore != null ? Number(moves[0].rollStockBefore) : null);
  for (const m of moves) {
    const q = Number(m.quantity);
    const rq = m.rollQuantity != null ? Number(m.rollQuantity) : 0;
    const dq = m.type === 'IN' ? q : m.type === 'OUT' ? -q : Number(m.stockAfter ?? 0) - Number(m.stockBefore ?? 0);
    const dr = m.type === 'IN' ? rq : m.type === 'OUT' ? -rq
      : (m.rollStockAfter != null && m.rollStockBefore != null ? Number(m.rollStockAfter) - Number(m.rollStockBefore) : 0);
    const sb = stock, rb = rolls;
    stock = r3(stock + dq);
    rolls = rolls == null ? null : r3(rolls + dr);
    await tx.inventoryMovement.update({
      where: { id: m.id },
      data: { stockBefore: sb, stockAfter: stock, rollStockBefore: rb, rollStockAfter: rolls },
    });
  }
}

export interface BackdatedPlan {
  deals: {
    date: string;
    title: string;
    amount: number;
    items: {
      productId: string; sku: string; name: string; unit: string;
      qty: number; price: number; lineTotal: number;
      rollCount: number | null; rollHow: string | null;
    }[];
  }[];
  total: number;
  warnings: string[];
  stock: { sku: string; name: string; unit: string; before: number; after: number; rollsBefore: number | null; rollsAfter: number | null }[];
}

async function buildPlan(dto: BackdatedDealsDto, db: Db): Promise<BackdatedPlan> {
  const [client, manager] = await Promise.all([
    db.client.findUnique({ where: { id: dto.clientId }, select: { id: true } }),
    db.user.findUnique({ where: { id: dto.managerId }, select: { id: true } }),
  ]);
  if (!client) throw new AppError(404, 'Клиент не найден');
  if (!manager) throw new AppError(404, 'Менеджер не найден');

  const today = new Date().toISOString().slice(0, 10);
  if (dto.items.some((x) => x.date > today)) throw new AppError(400, 'Дата сделки не может быть в будущем');

  const ids = [...new Set(dto.items.map((x) => x.productId))];
  const products = await db.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new AppError(404, `Товар не найден: ${missing.join(', ')}`);

  const estimate = await rollWeightEstimator(db);
  const warnings: string[] = [];
  const dates = [...new Set(dto.items.map((x) => x.date))].sort();

  const deals = dates.map((date) => {
    const items = dto.items.filter((x) => x.date === date).map((x) => {
      const p = byId.get(x.productId)!;
      let rollCount: number | null = null;
      let rollHow: string | null = null;
      if (isRollTrackedProduct(p)) {
        if (x.rollCount != null) {
          rollCount = x.rollCount; rollHow = 'указано';
        } else {
          const w = estimate(p.sku);
          if (!w) throw new AppError(400, `Не по чему оценить рулоны «${p.sku}» — укажите их вручную`);
          rollCount = Math.max(1, Math.round(x.qty / w.kg));
          rollHow = `${x.qty} ÷ ${w.kg.toFixed(1)} кг — ${w.how}`;
        }
      }
      return {
        productId: p.id, sku: p.sku, name: p.name, unit: p.unit,
        qty: x.qty, price: x.price, lineTotal: r2(x.qty * x.price), rollCount, rollHow,
      };
    });
    return { date, title: `Сделка от ${ruDate(date)}`, amount: r2(items.reduce((s, i) => s + i.lineTotal, 0)), items };
  });

  const touchesStock = dto.status === 'CLOSED' && dto.deductStock;
  const stock = ids.map((id) => {
    const p = byId.get(id)!;
    const lines = deals.flatMap((d) => d.items).filter((i) => i.productId === id);
    const qty = lines.reduce((s, i) => s + i.qty, 0);
    const rolls = lines.reduce((s, i) => s + (i.rollCount ?? 0), 0);
    const before = Number(p.stock);
    const rollsBefore = p.rollStock != null ? Number(p.rollStock) : null;
    const after = touchesStock ? r3(before - qty) : before;
    const rollsAfter = rollsBefore == null ? null : touchesStock ? r3(rollsBefore - rolls) : rollsBefore;
    if (touchesStock && after < 0) warnings.push(`«${p.sku}»: на складе ${before} ${p.unit}, списывается ${r3(qty)} — не хватает`);
    if (touchesStock && rollsAfter != null && rollsAfter < 0) warnings.push(`«${p.sku}»: рулонов станет ${rollsAfter}`);
    return { sku: p.sku, name: p.name, unit: p.unit, before, after, rollsBefore, rollsAfter };
  });

  // Дубль: у клиента уже есть сделки на эти даты.
  const existing = await db.deal.findMany({
    where: {
      clientId: dto.clientId,
      isArchived: false,
      createdAt: { gte: tashkentAt(dates[0], 0), lt: tashkentAt(dates[dates.length - 1], 24) },
    },
    select: { title: true, amount: true, createdAt: true },
  });
  for (const e of existing) {
    warnings.push(`У клиента уже есть «${e.title}» на ${Number(e.amount).toLocaleString('ru-RU')} — проверьте, не дубль ли`);
  }

  return { deals, total: r2(deals.reduce((s, d) => s + d.amount, 0)), warnings, stock };
}

export const backdatedDealsService = {
  preview(dto: BackdatedDealsDto) {
    return buildPlan(dto, prisma);
  },

  async create(dto: BackdatedDealsDto, userId: string) {
    const result = await prisma.$transaction((tx) => createInTx(tx, dto, userId), { timeout: 60_000 });

    for (const d of result.created) {
      await auditLog({
        userId, action: 'CREATE', entityType: 'deal', entityId: d.id,
        after: { title: d.title, amount: d.amount, backdated: true, status: dto.status, deductStock: dto.deductStock },
        reason: dto.reason,
      });
    }
    return { deals: result.created, total: result.plan.total, warnings: result.plan.warnings };
  },
};

/** Вся запись — внутри переданной транзакции (её же использует проверка с откатом). */
export async function createInTx(tx: Prisma.TransactionClient, dto: BackdatedDealsDto, userId: string) {
  const plan = await buildPlan(dto, tx);
  const blocking = plan.warnings.filter((w) => w.includes('не хватает'));
  if (blocking.length) throw new AppError(400, blocking.join('; '));

  const touchesStock = dto.status === 'CLOSED' && dto.deductStock;
  const earliestByProduct = new Map<string, Date>();
  const created: { id: string; title: string; amount: number }[] = [];

  for (const d of plan.deals) {
    const createdAt = tashkentAt(d.date, 10);
    const closedAt = tashkentAt(d.date, 17);
    const paid = dto.paymentState === 'PAID';
    const deal = await tx.deal.create({
      data: {
        title: d.title,
        status: dto.status,
        amount: d.amount,
        clientId: dto.clientId,
        managerId: dto.managerId,
        paymentMethod: dto.paymentMethod as PaymentMethod,
        paymentType: 'FULL',
        paidAmount: paid ? d.amount : 0,
        paymentStatus: paid ? 'PAID' : 'UNPAID',
        createdAt,
        closedAt: dto.status === 'CLOSED' ? closedAt : null,
        items: {
          create: d.items.map((i) => ({
            productId: i.productId,
            requestedQty: i.qty,
            price: i.price,
            lineTotal: i.lineTotal,
            rollCount: i.rollCount,
            createdAt,
          })),
        },
      },
    });
    created.push({ id: deal.id, title: deal.title, amount: d.amount });

    if (paid && d.amount > 0) {
      await tx.payment.create({
        data: {
          dealId: deal.id, clientId: dto.clientId, amount: d.amount, paidAt: closedAt,
          method: dto.paymentMethod, kind: 'CASH_IN', createdBy: userId, receivedById: userId,
          note: 'Оплата при создании сделки задним числом',
        },
      });
    }

    if (!touchesStock) continue;
    for (const i of d.items) {
      const p = await tx.product.findUniqueOrThrow({ where: { id: i.productId } });
      const sb = Number(p.stock);
      const rb = p.rollStock != null ? Number(p.rollStock) : null;
      const rolls = i.rollCount;
      const ra = rb != null && rolls != null ? r3(rb - rolls) : rb;
      await tx.inventoryMovement.create({
        data: {
          productId: i.productId, type: 'OUT', quantity: i.qty, rollQuantity: rolls,
          stockBefore: sb, stockAfter: r3(sb - i.qty), rollStockBefore: rb, rollStockAfter: ra,
          dealId: deal.id, note: 'Автосписание при закрытии сделки (задним числом)',
          createdBy: userId, createdAt: closedAt,
        },
      });
      await tx.product.update({
        where: { id: i.productId },
        data: { stock: r3(sb - i.qty), ...(ra != null ? { rollStock: ra } : {}) },
      });
      const prev = earliestByProduct.get(i.productId);
      if (!prev || closedAt < prev) earliestByProduct.set(i.productId, closedAt);
    }
  }

  // Движения записаны прошлой датой — выравниваем «до/после» у всех более поздних.
  for (const [productId, from] of earliestByProduct) await rechainFrom(tx, productId, from);

  return { plan, created };
}
