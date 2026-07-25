import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { authorize } from '../../middleware/authorize';

const router = Router();

router.use(authenticate);

/** Категория товара, для которого вручную вводится вес в кг. */
const LAMINATION_CATEGORY = 'Ламинационная пленка';

type ManagerKgRow = {
  manager_id: string;
  manager_name: string;
  manager_role: string;
  items_count: string;
  deals_count: string;
  total_kg: string;
  via_warehouse_count: string;
};

function parseDateParam(raw: unknown, fallback: Date): Date {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const from = parseDateParam(req.query.from, startOfToday());
    const toRaw = parseDateParam(req.query.to, new Date());
    // «to» включительно — если передана только дата, захватываем весь день.
    const to = new Date(toRaw);
    if (typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) {
      to.setHours(23, 59, 59, 999);
    }

    // Кг могли ввести двумя путями:
    //  1) менеджер сразу при создании сделки — тогда di.confirmed_by пусто, автор = deal.manager_id;
    //  2) склад позже через «Ответ склада» (submitWarehouseResponse) — тогда di.confirmed_by/confirmed_at
    //     заполнены тем, кто фактически ввёл число, и именно ему нужно приписать позицию, а не
    //     менеджеру, который изначально оставил поле пустым.
    // Дата для фильтра «from/to» берётся так же: момент реального ввода (confirmed_at), а не создания позиции.
    const rows = await prisma.$queryRaw<ManagerKgRow[]>(Prisma.sql`
      SELECT
        eu.id AS manager_id,
        eu.full_name AS manager_name,
        eu.role AS manager_role,
        COUNT(*)::text AS items_count,
        COUNT(DISTINCT di.deal_id)::text AS deals_count,
        COALESCE(SUM(di.requested_qty::numeric), 0)::text AS total_kg,
        COUNT(*) FILTER (WHERE di.confirmed_by IS NOT NULL)::text AS via_warehouse_count
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN products p ON p.id = di.product_id
      JOIN users eu ON eu.id = COALESCE(di.confirmed_by, d.manager_id)
      WHERE p.category = ${LAMINATION_CATEGORY}
        AND di.requested_qty IS NOT NULL
        AND di.requested_qty::numeric > 0
        AND COALESCE(di.confirmed_at, di.created_at) >= ${from}
        AND COALESCE(di.confirmed_at, di.created_at) <= ${to}
      GROUP BY eu.id, eu.full_name, eu.role
      ORDER BY COUNT(*) DESC
    `);

    const byManager = rows.map((r) => ({
      managerId: r.manager_id,
      managerName: r.manager_name,
      managerRole: r.manager_role,
      itemsCount: Number(r.items_count),
      dealsCount: Number(r.deals_count),
      totalKg: Number(r.total_kg),
      viaWarehouseCount: Number(r.via_warehouse_count),
    }));

    const totals = byManager.reduce(
      (acc, m) => ({
        itemsCount: acc.itemsCount + m.itemsCount,
        dealsCount: acc.dealsCount + m.dealsCount,
        totalKg: acc.totalKg + m.totalKg,
        viaWarehouseCount: acc.viaWarehouseCount + m.viaWarehouseCount,
      }),
      { itemsCount: 0, dealsCount: 0, totalKg: 0, viaWarehouseCount: 0 },
    );

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      totals,
      byManager,
    });
  }),
);

export { router as laminationKgUsageRoutes };
