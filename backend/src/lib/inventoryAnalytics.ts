import type { MovementType } from '@prisma/client';
import { Prisma } from '@prisma/client';

/**
 * Inventory movement semantics for analytics (not stock math).
 *
 * SALE: outgoing stock tied to a deal (отгрузка / «реальный расход» для аналитики).
 * CORRECTION: explicit correction or legacy/manual OUT without deal (не продажа).
 */
export function isInventorySaleMovement(type: MovementType, dealId: string | null | undefined): boolean {
  return type === 'OUT' && dealId != null;
}

export function isInventoryCorrectionMovement(type: MovementType, dealId: string | null | undefined): boolean {
  return type === 'CORRECTION' || (type === 'OUT' && dealId == null);
}

/** Predicate for raw SQL with table alias `m` (inventory_movements). */
export function sqlMovementIsSale(alias = 'm'): Prisma.Sql {
  return Prisma.raw(`(${alias}.type = 'OUT' AND ${alias}.deal_id IS NOT NULL)`);
}

/** CORRECTION type or OUT without deal_id (manual/import/unlinked). */
export function sqlMovementIsAnalyticsCorrection(alias = 'm'): Prisma.Sql {
  return Prisma.raw(
    `(${alias}.type = 'CORRECTION' OR (${alias}.type = 'OUT' AND ${alias}.deal_id IS NULL))`,
  );
}

export type ChartGranularity = 'day' | 'month' | 'quarter';

/** ~месяц: только день; ~квартал: день|месяц; ~год: день|месяц|квартал */
export function resolveProductChartGranularity(
  periodDays: number,
  requested?: string | null,
): { granularity: ChartGranularity; allowed: ChartGranularity[] } {
  const q = (requested || '').toLowerCase().trim();

  if (periodDays <= 35) {
    return { granularity: 'day', allowed: ['day'] };
  }

  if (periodDays <= 120) {
    const allowed: ChartGranularity[] = ['day', 'month'];
    if (q === 'day' || q === 'month') return { granularity: q, allowed };
    return { granularity: 'month', allowed };
  }

  const allowed: ChartGranularity[] = ['day', 'month', 'quarter'];
  if (q === 'day' || q === 'month' || q === 'quarter') return { granularity: q, allowed };
  return { granularity: 'month', allowed };
}

/** SQL time bucket for inventory_movements alias `m` (PostgreSQL). */
export function sqlInventoryMovementBucket(granularity: ChartGranularity): Prisma.Sql {
  switch (granularity) {
    case 'day':
      return Prisma.sql`(m.created_at::date)`;
    case 'month':
      return Prisma.sql`date_trunc('month', m.created_at)`;
    case 'quarter':
      return Prisma.sql`date_trunc('quarter', m.created_at)`;
    default:
      return Prisma.sql`(m.created_at::date)`;
  }
}
